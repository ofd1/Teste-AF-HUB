import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AppCategory, AppStatus, Role } from "@prisma/client";
import { appEngine } from "./service";
import { JwtPayload, requireRole } from "../auth/routes";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createAppBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  category: z.nativeEnum(AppCategory),
});

const updateAppBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().optional(),
  category: z.nativeEnum(AppCategory).optional(),
  status: z.nativeEnum(AppStatus).optional(),
  icon: z.string().optional(),
  tags: z.array(z.string()).optional(),
  isPublic: z.boolean().optional(),
});

const listAppsQuerySchema = z.object({
  status: z.nativeEnum(AppStatus).optional(),
  category: z.nativeEnum(AppCategory).optional(),
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
});

const createVersionBodySchema = z.object({
  version: z
    .string()
    .regex(/^\d+\.\d+\.\d+/, "version must follow semver (e.g. 1.0.0)"),
  changelog: z.string().optional(),
  sourceCode: z.string().min(1),
  config: z.record(z.unknown()).optional(),
  setCurrent: z.boolean().default(false),
});

const rollbackBodySchema = z.object({
  versionId: z.string().uuid(),
});

// ─── Helper: parse body ───────────────────────────────────────────────────────

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

export async function appRoutes(fastify: FastifyInstance): Promise<void> {
  // Shared preHandlers
  const auth = async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  };

  const adminOrManager = requireRole(Role.ADMIN, Role.MANAGER);

  // ── POST /apps ────────────────────────────────────────────────────────────
  fastify.post(
    "/apps",
    { preHandler: [adminOrManager] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createAppBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const app = await appEngine.createApp({ ...body, authorId: user.id });
        return reply.status(201).send(app);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /apps ─────────────────────────────────────────────────────────────
  fastify.get(
    "/apps",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const parsed = listAppsQuerySchema.safeParse(request.query);
      if (!parsed.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: parsed.error.issues.map((i) => i.message).join("; "),
        });
      }

      try {
        const result = await appEngine.listApps(parsed.data);
        return reply.status(200).send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /apps/:id ─────────────────────────────────────────────────────────
  fastify.get(
    "/apps/:id",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const app = await appEngine.getApp(request.params.id);
        return reply.status(200).send(app);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── PUT /apps/:id ─────────────────────────────────────────────────────────
  fastify.put(
    "/apps/:id",
    { preHandler: [adminOrManager] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(updateAppBodySchema, request.body, reply);
      if (!body) return;

      try {
        const app = await appEngine.updateApp(request.params.id, body);
        return reply.status(200).send(app);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── DELETE /apps/:id ──────────────────────────────────────────────────────
  fastify.delete(
    "/apps/:id",
    { preHandler: [adminOrManager] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        await appEngine.deleteApp(request.params.id);
        return reply.status(204).send();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /apps/:id/publish ────────────────────────────────────────────────
  fastify.post(
    "/apps/:id/publish",
    { preHandler: [adminOrManager] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const app = await appEngine.publishApp(request.params.id);
        return reply.status(200).send(app);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /apps/:id/versions ───────────────────────────────────────────────
  fastify.post(
    "/apps/:id/versions",
    { preHandler: [adminOrManager] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(createVersionBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const version = await appEngine.createVersion(request.params.id, {
          ...body,
          authorId: user.id,
        });
        return reply.status(201).send(version);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        if (message.includes("Unique constraint")) {
          return reply.status(409).send({
            statusCode: 409,
            error: "Conflict",
            message: `Version "${body.version}" already exists for this app.`,
          });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /apps/:id/versions ────────────────────────────────────────────────
  fastify.get(
    "/apps/:id/versions",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const versions = await appEngine.listVersions(request.params.id);
        return reply.status(200).send(versions);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /apps/:id/rollback ───────────────────────────────────────────────
  fastify.post(
    "/apps/:id/rollback",
    { preHandler: [adminOrManager] },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(rollbackBodySchema, request.body, reply);
      if (!body) return;

      try {
        const app = await appEngine.rollbackVersion(
          request.params.id,
          body.versionId,
        );
        return reply.status(200).send(app);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        if (message === "App not found" || message === "Version not found for this app") {
          return reply
            .status(404)
            .send({ statusCode: 404, error: "Not Found", message });
        }
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );
}
