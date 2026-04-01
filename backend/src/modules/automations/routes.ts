import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AutomationTrigger } from "@prisma/client";
import { automationEngine } from "./service";
import { JwtPayload } from "../auth/routes";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createAutomationBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  trigger: z.nativeEnum(AutomationTrigger),
  triggerConfig: z.record(z.unknown()).optional(),
  actions: z.array(z.record(z.unknown())).min(1),
});

const updateAutomationBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  trigger: z.nativeEnum(AutomationTrigger).optional(),
  triggerConfig: z.record(z.unknown()).optional(),
  actions: z.array(z.record(z.unknown())).min(1).optional(),
});

const listAutomationsQuerySchema = z.object({
  authorId: z.string().uuid().optional(),
});

const triggerBodySchema = z.object({
  input: z.any().optional(),
});

const runHistoryQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
});

// ─── Inferred body types ──────────────────────────────────────────────────────

type CreateAutomationBody = z.infer<typeof createAutomationBodySchema>;
type UpdateAutomationBody = z.infer<typeof updateAutomationBodySchema>;
type TriggerBody = { input?: unknown };

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

export async function automationRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  };

  // ── POST /automations ─────────────────────────────────────────────────────
  fastify.post(
    "/automations",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createAutomationBodySchema, request.body, reply) as CreateAutomationBody | null;
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const automation = await automationEngine.createAutomation({
          name: body.name,
          description: body.description,
          trigger: body.trigger,
          triggerConfig: body.triggerConfig,
          actions: body.actions as unknown[],
          authorId: user.id,
        });
        return reply.status(201).send(automation);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /automations ──────────────────────────────────────────────────────
  fastify.get(
    "/automations",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listAutomationsQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: query.error.issues.map((i) => i.message).join("; "),
        });
      }

      try {
        const automations = await automationEngine.listAutomations(
          query.data.authorId,
        );
        return reply.status(200).send(automations);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /automations/:id ──────────────────────────────────────────────────
  fastify.get(
    "/automations/:id",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const automation = await automationEngine.getAutomation(
          request.params.id,
        );
        if (!automation) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Automation not found",
          });
        }
        return reply.status(200).send(automation);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── PUT /automations/:id ──────────────────────────────────────────────────
  fastify.put(
    "/automations/:id",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(updateAutomationBodySchema, request.body, reply) as UpdateAutomationBody | null;
      if (!body) return;

      try {
        const automation = await automationEngine.updateAutomation(
          request.params.id,
          body,
        );
        return reply.status(200).send(automation);
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

  // ── DELETE /automations/:id ───────────────────────────────────────────────
  fastify.delete(
    "/automations/:id",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        await automationEngine.deleteAutomation(request.params.id);
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

  // ── POST /automations/:id/pause ───────────────────────────────────────────
  fastify.post(
    "/automations/:id/pause",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const automation = await automationEngine.pauseAutomation(
          request.params.id,
        );
        return reply.status(200).send(automation);
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

  // ── POST /automations/:id/resume ──────────────────────────────────────────
  fastify.post(
    "/automations/:id/resume",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const automation = await automationEngine.resumeAutomation(
          request.params.id,
        );
        return reply.status(200).send(automation);
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

  // ── POST /automations/:id/trigger ─────────────────────────────────────────
  fastify.post(
    "/automations/:id/trigger",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(triggerBodySchema, request.body, reply) as TriggerBody | null;
      if (!body) return;

      try {
        const result = await automationEngine.triggerAutomation(
          request.params.id,
          body.input,
        );
        return reply.status(202).send(result);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        if (message.includes("not found")) {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        if (message.includes("paused")) {
          return reply
            .status(409)
            .send({ statusCode: 409, error: "Conflict", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /automations/:id/runs ─────────────────────────────────────────────
  fastify.get(
    "/automations/:id/runs",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const query = runHistoryQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: query.error.issues.map((i) => i.message).join("; "),
        });
      }

      try {
        const runs = await automationEngine.getRunHistory(
          request.params.id,
          query.data.limit,
        );
        return reply.status(200).send(runs);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );
}
