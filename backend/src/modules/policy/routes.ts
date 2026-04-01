import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { Role } from "@prisma/client";
import { policyEngine } from "./engine";
import { JwtPayload, requireRole } from "../auth/routes";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createRuleBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  resource: z.string().min(1),
  action: z.string().min(1),
  conditions: z.record(z.unknown()),
  effect: z.enum(["allow", "deny"]),
  priority: z.number().int().optional(),
});

const updateRuleBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  resource: z.string().min(1).optional(),
  action: z.string().min(1).optional(),
  conditions: z.record(z.unknown()).optional(),
  effect: z.enum(["allow", "deny"]).optional(),
  priority: z.number().int().optional(),
  isActive: z.boolean().optional(),
});

const listRulesQuerySchema = z.object({
  resource: z.string().optional(),
});

const evaluateBodySchema = z.object({
  resource: z.string().min(1),
  action: z.string().min(1),
  metadata: z.record(z.unknown()).optional(),
});

const auditLogsQuerySchema = z.object({
  userId: z.string().optional(),
  action: z.string().optional(),
  resource: z.string().optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// ─── Helper ───────────────────────────────────────────────────────────────────

function parseBody<T>(
  schema: z.ZodSchema<T>,
  body: unknown,
  reply: FastifyReply,
): T | null {
  const result = schema.safeParse(body);
  if (!result.success) {
    reply.status(400).send({
      statusCode: 400,
      error: "Bad Request",
      message: result.error.issues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; "),
    });
    return null;
  }
  return result.data;
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function policyRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  };

  const adminOnly = requireRole(Role.ADMIN);

  // ── POST /policy/rules ────────────────────────────────────────────────────
  fastify.post(
    "/policy/rules",
    { preHandler: [adminOnly] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createRuleBodySchema, request.body, reply);
      if (!body) return;

      try {
        const rule = await policyEngine.createRule(body);
        return reply.status(201).send(rule);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /policy/rules ─────────────────────────────────────────────────────
  fastify.get(
    "/policy/rules",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listRulesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: query.error.issues.map((i) => i.message).join("; "),
        });
      }

      try {
        const rules = await policyEngine.listRules(query.data.resource);
        return reply.status(200).send(rules);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /policy/rules/:id ─────────────────────────────────────────────────
  fastify.get(
    "/policy/rules/:id",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const rule = await policyEngine.getRule(request.params.id);
        if (!rule) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Policy rule not found",
          });
        }
        return reply.status(200).send(rule);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── PUT /policy/rules/:id ─────────────────────────────────────────────────
  fastify.put(
    "/policy/rules/:id",
    { preHandler: [adminOnly] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(updateRuleBodySchema, request.body, reply);
      if (!body) return;

      try {
        const rule = await policyEngine.updateRule(request.params.id, body);
        return reply.status(200).send(rule);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        const statusCode = message.includes("not found") ? 404 : 500;
        return reply.status(statusCode).send({
          statusCode,
          error: statusCode === 404 ? "Not Found" : "Internal Server Error",
          message,
        });
      }
    },
  );

  // ── DELETE /policy/rules/:id ──────────────────────────────────────────────
  fastify.delete(
    "/policy/rules/:id",
    { preHandler: [adminOnly] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        await policyEngine.deleteRule(request.params.id);
        return reply.status(204).send();
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        const statusCode = message.includes("not found") ? 404 : 500;
        return reply.status(statusCode).send({
          statusCode,
          error: statusCode === 404 ? "Not Found" : "Internal Server Error",
          message,
        });
      }
    },
  );

  // ── POST /policy/evaluate ─────────────────────────────────────────────────
  fastify.post(
    "/policy/evaluate",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(evaluateBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const result = await policyEngine.evaluate({
          userId: user.id,
          role: user.role,
          resource: body.resource,
          action: body.action,
          metadata: body.metadata,
        });
        return reply.status(200).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /audit/logs ───────────────────────────────────────────────────────
  fastify.get(
    "/audit/logs",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = auditLogsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: query.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      }

      try {
        const result = await policyEngine.getAuditLogs(query.data);
        return reply.status(200).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /audit/stats ──────────────────────────────────────────────────────
  fastify.get(
    "/audit/stats",
    { preHandler: [auth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const stats = await policyEngine.getAuditStats();
        return reply.status(200).send(stats);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );
}
