import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PolicyConditions {
  roles?: string[];
  users?: string[];
  [key: string]: unknown;
}

interface CreateRuleData {
  name: string;
  description?: string;
  resource: string;
  action: string;
  conditions: PolicyConditions;
  effect: "allow" | "deny";
  priority?: number;
}

interface UpdateRuleData {
  name?: string;
  description?: string;
  resource?: string;
  action?: string;
  conditions?: PolicyConditions;
  effect?: "allow" | "deny";
  priority?: number;
  isActive?: boolean;
}

interface EvaluationContext {
  userId: string;
  role: string;
  resource: string;
  action: string;
  metadata?: any;
}

interface EvaluationResult {
  allowed: boolean;
  matchedRules: string[];
  reason?: string;
}

interface AuditLogFilters {
  userId?: string;
  action?: string;
  resource?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

// ─── PolicyEngine ─────────────────────────────────────────────────────────────

class PolicyEngine {
  // ── Rule CRUD ───────────────────────────────────────────────────────────────

  async createRule(data: CreateRuleData) {
    const rule = await prisma.policyRule.create({
      data: {
        name: data.name,
        description: data.description,
        resource: data.resource,
        action: data.action,
        conditions: data.conditions as any,
        effect: data.effect,
        priority: data.priority ?? 0,
      },
    });

    await logAudit({
      action: "policy.rule.create",
      resource: `policy_rule:${rule.id}`,
      details: { ruleName: rule.name, resource: rule.resource, action: rule.action, effect: rule.effect },
    });

    return rule;
  }

  async listRules(resource?: string) {
    return prisma.policyRule.findMany({
      where: resource ? { resource } : undefined,
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    });
  }

  async getRule(id: string) {
    return prisma.policyRule.findUnique({ where: { id } });
  }

  async updateRule(id: string, data: UpdateRuleData) {
    const rule = await prisma.policyRule.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.resource !== undefined && { resource: data.resource }),
        ...(data.action !== undefined && { action: data.action }),
        ...(data.conditions !== undefined && { conditions: data.conditions as any }),
        ...(data.effect !== undefined && { effect: data.effect }),
        ...(data.priority !== undefined && { priority: data.priority }),
        ...(data.isActive !== undefined && { isActive: data.isActive }),
      },
    });

    await logAudit({
      action: "policy.rule.update",
      resource: `policy_rule:${rule.id}`,
      details: { ruleName: rule.name, changes: data },
    });

    return rule;
  }

  async deleteRule(id: string) {
    const rule = await prisma.policyRule.delete({ where: { id } });

    await logAudit({
      action: "policy.rule.delete",
      resource: `policy_rule:${id}`,
      details: { ruleName: rule.name },
    });

    return rule;
  }

  // ── Policy Evaluation ────────────────────────────────────────────────────────

  async evaluate(context: EvaluationContext): Promise<EvaluationResult> {
    // Fetch all active rules matching resource + action, sorted by priority desc
    const rules = await prisma.policyRule.findMany({
      where: {
        resource: context.resource,
        action: context.action,
        isActive: true,
      },
      orderBy: { priority: "desc" },
    });

    const matchedRules: string[] = [];
    let denyRule: string | null = null;
    let allowRule: string | null = null;

    for (const rule of rules) {
      const conditions = rule.conditions as PolicyConditions;
      let matches = true;

      // Check role condition
      if (conditions.roles && Array.isArray(conditions.roles)) {
        if (!conditions.roles.includes(context.role)) {
          matches = false;
        }
      }

      // Check user condition
      if (matches && conditions.users && Array.isArray(conditions.users)) {
        if (!conditions.users.includes(context.userId)) {
          matches = false;
        }
      }

      // Check any additional metadata conditions
      if (matches && context.metadata) {
        for (const [key, value] of Object.entries(conditions)) {
          if (key === "roles" || key === "users") continue;
          if (context.metadata[key] !== undefined && context.metadata[key] !== value) {
            matches = false;
            break;
          }
        }
      }

      if (matches) {
        matchedRules.push(rule.name);

        if (rule.effect === "deny" && denyRule === null) {
          denyRule = rule.name;
        } else if (rule.effect === "allow" && allowRule === null) {
          allowRule = rule.name;
        }
      }
    }

    // Deny takes precedence over allow
    if (denyRule !== null) {
      return {
        allowed: false,
        matchedRules,
        reason: `Denied by rule: ${denyRule}`,
      };
    }

    if (allowRule !== null) {
      return {
        allowed: true,
        matchedRules,
        reason: `Allowed by rule: ${allowRule}`,
      };
    }

    // Default deny when no rules match
    return {
      allowed: false,
      matchedRules: [],
      reason: "No matching policy rules found; default deny",
    };
  }

  // ── Audit Logs ───────────────────────────────────────────────────────────────

  async getAuditLogs(filters: AuditLogFilters) {
    const page = filters.page ?? 1;
    const limit = Math.min(filters.limit ?? 50, 200);
    const skip = (page - 1) * limit;

    const where: Record<string, any> = {};

    if (filters.userId) where.userId = filters.userId;
    if (filters.action) where.action = { contains: filters.action };
    if (filters.resource) where.resource = { contains: filters.resource };

    if (filters.from || filters.to) {
      where.createdAt = {};
      if (filters.from) where.createdAt.gte = filters.from;
      if (filters.to) where.createdAt.lte = filters.to;
    }

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip,
        take: limit,
        include: {
          user: {
            select: { id: true, name: true, email: true, role: true },
          },
        },
      }),
    ]);

    return {
      data: logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  async getAuditStats() {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    const [totalLogs, allLogs, recentLogs] = await Promise.all([
      prisma.auditLog.count(),

      // Fetch all logs needed for grouping (action, userId)
      prisma.auditLog.findMany({
        select: { action: true, userId: true },
      }),

      // Fetch recent logs for per-day stats
      prisma.auditLog.findMany({
        where: { createdAt: { gte: thirtyDaysAgo } },
        select: { createdAt: true },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    // Logs per action
    const actionCounts: Record<string, number> = {};
    for (const log of allLogs) {
      actionCounts[log.action] = (actionCounts[log.action] ?? 0) + 1;
    }
    const logsPerAction = Object.entries(actionCounts)
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count);

    // Logs per user (top 10)
    const userCounts: Record<string, number> = {};
    for (const log of allLogs) {
      if (log.userId) {
        userCounts[log.userId] = (userCounts[log.userId] ?? 0) + 1;
      }
    }
    const logsPerUser = Object.entries(userCounts)
      .map(([userId, count]) => ({ userId, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 10);

    // Logs per day (last 30 days)
    const dayCounts: Record<string, number> = {};
    for (const log of recentLogs) {
      const day = log.createdAt.toISOString().split("T")[0];
      dayCounts[day] = (dayCounts[day] ?? 0) + 1;
    }
    const logsPerDay = Object.entries(dayCounts)
      .map(([date, count]) => ({ date, count }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalLogs,
      logsPerAction,
      logsPerUser,
      logsPerDay,
    };
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const policyEngine = new PolicyEngine();
