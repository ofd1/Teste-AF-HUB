import { AutomationStatus, AutomationTrigger } from "@prisma/client";
import * as cron from "node-cron";
import { prisma } from "../../lib/prisma";
import { logAudit } from "../../lib/audit";
import { automationQueue } from "../../lib/queue";

// ─── Types ────────────────────────────────────────────────────────────────────

interface CreateAutomationData {
  name: string;
  description?: string;
  trigger: AutomationTrigger;
  triggerConfig?: Record<string, unknown>;
  actions: unknown[];
  authorId: string;
}

interface UpdateAutomationData {
  name?: string;
  description?: string;
  trigger?: AutomationTrigger;
  triggerConfig?: Record<string, unknown>;
  actions?: unknown[];
}

// ─── AutomationEngine ─────────────────────────────────────────────────────────

class AutomationEngine {
  /** Tracks active cron jobs keyed by automation id */
  private scheduledJobs = new Map<string, cron.ScheduledTask>();

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async createAutomation(data: CreateAutomationData) {
    const automation = await prisma.automation.create({
      data: {
        name: data.name,
        description: data.description,
        trigger: data.trigger,
        triggerConfig: data.triggerConfig ?? undefined,
        actions: data.actions,
        authorId: data.authorId,
        status: AutomationStatus.ACTIVE,
      },
    });

    await logAudit({
      action: "automation.create",
      resource: `automation:${automation.id}`,
      userId: data.authorId,
      details: { name: automation.name, trigger: automation.trigger },
    });

    if (automation.trigger === AutomationTrigger.CRON) {
      this.scheduleCron(automation as any);
    }

    return automation;
  }

  async listAutomations(authorId?: string) {
    return prisma.automation.findMany({
      where: authorId ? { authorId } : undefined,
      orderBy: { createdAt: "desc" },
      include: {
        _count: { select: { runs: true } },
      },
    });
  }

  async getAutomation(id: string) {
    return prisma.automation.findUnique({
      where: { id },
      include: {
        runs: {
          orderBy: { startedAt: "desc" },
          take: 20,
        },
      },
    });
  }

  async updateAutomation(id: string, data: UpdateAutomationData) {
    const existing = await prisma.automation.findUnique({ where: { id } });
    if (!existing) throw new Error(`Automation ${id} not found`);

    const automation = await prisma.automation.update({
      where: { id },
      data: {
        ...(data.name !== undefined && { name: data.name }),
        ...(data.description !== undefined && { description: data.description }),
        ...(data.trigger !== undefined && { trigger: data.trigger }),
        ...(data.triggerConfig !== undefined && { triggerConfig: data.triggerConfig }),
        ...(data.actions !== undefined && { actions: data.actions }),
      },
    });

    await logAudit({
      action: "automation.update",
      resource: `automation:${id}`,
      details: { changes: data },
    });

    // Reschedule cron if trigger or config changed and automation is active
    const triggerChanged = data.trigger !== undefined || data.triggerConfig !== undefined;
    if (triggerChanged && automation.status === AutomationStatus.ACTIVE) {
      this.unscheduleCron(id);
      if (automation.trigger === AutomationTrigger.CRON) {
        this.scheduleCron(automation as any);
      }
    }

    return automation;
  }

  async deleteAutomation(id: string) {
    this.unscheduleCron(id);

    const automation = await prisma.automation.delete({ where: { id } });

    await logAudit({
      action: "automation.delete",
      resource: `automation:${id}`,
      details: { name: automation.name },
    });

    return automation;
  }

  // ── Status controls ───────────────────────────────────────────────────────

  async pauseAutomation(id: string) {
    const automation = await prisma.automation.update({
      where: { id },
      data: { status: AutomationStatus.PAUSED },
    });

    this.unscheduleCron(id);

    await logAudit({
      action: "automation.pause",
      resource: `automation:${id}`,
    });

    return automation;
  }

  async resumeAutomation(id: string) {
    const automation = await prisma.automation.update({
      where: { id },
      data: { status: AutomationStatus.ACTIVE },
    });

    if (automation.trigger === AutomationTrigger.CRON) {
      this.scheduleCron(automation as any);
    }

    await logAudit({
      action: "automation.resume",
      resource: `automation:${id}`,
    });

    return automation;
  }

  // ── Manual trigger ────────────────────────────────────────────────────────

  async triggerAutomation(id: string, input?: unknown) {
    const automation = await prisma.automation.findUnique({ where: { id } });
    if (!automation) throw new Error(`Automation ${id} not found`);
    if (automation.status === AutomationStatus.PAUSED) {
      throw new Error(`Automation ${id} is paused`);
    }

    const job = await automationQueue.add(
      "run-automation",
      { automationId: id, input },
      { attempts: 3, backoff: { type: "exponential", delay: 2000 } },
    );

    await logAudit({
      action: "automation.trigger",
      resource: `automation:${id}`,
      details: { jobId: job.id, input },
    });

    return { jobId: job.id, automationId: id };
  }

  // ── Run history ───────────────────────────────────────────────────────────

  async getRunHistory(automationId: string, limit = 50) {
    return prisma.automationRun.findMany({
      where: { automationId },
      orderBy: { startedAt: "desc" },
      take: limit,
    });
  }

  // ── Internal: cron scheduling helpers ────────────────────────────────────

  private scheduleCron(automation: {
    id: string;
    name: string;
    triggerConfig: unknown;
  }) {
    const config = automation.triggerConfig as Record<string, unknown> | null;
    const expression = config?.expression as string | undefined;

    if (!expression) {
      console.warn(
        `[AutomationEngine] Automation "${automation.name}" (${automation.id}) ` +
          `has CRON trigger but no expression in triggerConfig`,
      );
      return;
    }

    if (!cron.validate(expression)) {
      console.warn(
        `[AutomationEngine] Invalid cron expression "${expression}" for automation ${automation.id}`,
      );
      return;
    }

    // Cancel any existing task before scheduling a new one
    this.unscheduleCron(automation.id);

    const task = cron.schedule(expression, async () => {
      try {
        await this.triggerAutomation(automation.id);
      } catch (err) {
        console.error(
          `[AutomationEngine] Cron trigger failed for automation ${automation.id}:`,
          err,
        );
      }
    });

    this.scheduledJobs.set(automation.id, task);
    console.log(
      `[AutomationEngine] Scheduled cron "${expression}" for automation ${automation.id}`,
    );
  }

  private unscheduleCron(id: string) {
    const task = this.scheduledJobs.get(id);
    if (task) {
      task.stop();
      this.scheduledJobs.delete(id);
      console.log(`[AutomationEngine] Unscheduled cron for automation ${id}`);
    }
  }

  // ── Bootstrap ─────────────────────────────────────────────────────────────

  /** Load all ACTIVE CRON automations from the database and schedule them.
   *  Call this once on server start. */
  async startAllCronJobs() {
    const automations = await prisma.automation.findMany({
      where: {
        trigger: AutomationTrigger.CRON,
        status: AutomationStatus.ACTIVE,
      },
    });

    for (const automation of automations) {
      this.scheduleCron(automation as any);
    }

    console.log(
      `[AutomationEngine] Bootstrapped ${automations.length} cron automation(s)`,
    );
  }
}

// ─── Singleton export ─────────────────────────────────────────────────────────

export const automationEngine = new AutomationEngine();
