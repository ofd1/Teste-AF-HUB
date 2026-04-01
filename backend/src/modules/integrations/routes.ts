import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { integrationsHub } from "./service";
import { JwtPayload } from "../auth/routes";

// ─── Validation schemas ───────────────────────────────────────────────────────

const createIntegrationBodySchema = z.object({
  name: z.string().min(1).max(200),
  provider: z.string().min(1).max(100),
  config: z.record(z.unknown()).default({}),
});

const updateIntegrationBodySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  provider: z.string().min(1).max(100).optional(),
  config: z.record(z.unknown()).optional(),
});

const executeConnectorBodySchema = z.object({
  params: z.record(z.unknown()).default({}),
});

const testConnectionBodySchema = z.object({
  provider: z.string().min(1).max(100),
  config: z.record(z.unknown()).default({}),
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

export async function integrationRoutes(fastify: FastifyInstance): Promise<void> {
  const auth = async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  };

  // ── GET /integrations/connectors ─────────────────────────────────────────
  fastify.get(
    "/integrations/connectors",
    { preHandler: [auth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const connectors = integrationsHub.listConnectors();
        return reply.send({ data: connectors, total: connectors.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /integrations/test ───────────────────────────────────────────────
  // Declared before /:id routes to avoid route shadowing
  fastify.post(
    "/integrations/test",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(testConnectionBodySchema, request.body, reply);
      if (!body) return;

      try {
        const result = await integrationsHub.testConnection(body.provider, body.config);
        return reply.send(result);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /integrations ────────────────────────────────────────────────────
  fastify.post(
    "/integrations",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createIntegrationBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const integration = await integrationsHub.createIntegration({
          ...body,
          userId: user.id,
        });
        return reply.status(201).send(integration);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /integrations ─────────────────────────────────────────────────────
  fastify.get(
    "/integrations",
    { preHandler: [auth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const integrations = await integrationsHub.listIntegrations();
        return reply.send({ data: integrations, total: integrations.length });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply
          .status(500)
          .send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /integrations/:id ─────────────────────────────────────────────────
  fastify.get(
    "/integrations/:id",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };

      try {
        const integration = await integrationsHub.getIntegration(id);
        return reply.send(integration);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const isNotFound = message.includes("not found");
        return reply
          .status(isNotFound ? 404 : 500)
          .send({
            statusCode: isNotFound ? 404 : 500,
            error: isNotFound ? "Not Found" : "Internal Server Error",
            message,
          });
      }
    },
  );

  // ── PUT /integrations/:id ─────────────────────────────────────────────────
  fastify.put(
    "/integrations/:id",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = parseBody(updateIntegrationBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const integration = await integrationsHub.updateIntegration(id, {
          ...body,
          userId: user.id,
        });
        return reply.send(integration);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const isNotFound = message.includes("not found");
        return reply
          .status(isNotFound ? 404 : 500)
          .send({
            statusCode: isNotFound ? 404 : 500,
            error: isNotFound ? "Not Found" : "Internal Server Error",
            message,
          });
      }
    },
  );

  // ── DELETE /integrations/:id ──────────────────────────────────────────────
  fastify.delete(
    "/integrations/:id",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const user = request.user as JwtPayload;

      try {
        await integrationsHub.deleteIntegration(id, user.id);
        return reply.status(204).send();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const isNotFound = message.includes("not found");
        return reply
          .status(isNotFound ? 404 : 500)
          .send({
            statusCode: isNotFound ? 404 : 500,
            error: isNotFound ? "Not Found" : "Internal Server Error",
            message,
          });
      }
    },
  );

  // ── POST /integrations/:id/sync ───────────────────────────────────────────
  fastify.post(
    "/integrations/:id/sync",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const user = request.user as JwtPayload;

      try {
        const integration = await integrationsHub.syncIntegration(id, user.id);
        return reply.send({ message: "Sync job queued", integration });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const isNotFound = message.includes("not found");
        return reply
          .status(isNotFound ? 404 : 500)
          .send({
            statusCode: isNotFound ? 404 : 500,
            error: isNotFound ? "Not Found" : "Internal Server Error",
            message,
          });
      }
    },
  );

  // ── POST /integrations/:id/execute ────────────────────────────────────────
  fastify.post(
    "/integrations/:id/execute",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const { id } = request.params as { id: string };
      const body = parseBody(executeConnectorBodySchema, request.body, reply);
      if (!body) return;

      try {
        const integration = await integrationsHub.getIntegration(id);
        const result = await integrationsHub.executeConnector(
          integration.provider,
          integration.config,
          body.params,
        );
        return reply.send({ data: result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const isNotFound = message.includes("not found");
        return reply
          .status(isNotFound ? 404 : 500)
          .send({
            statusCode: isNotFound ? 404 : 500,
            error: isNotFound ? "Not Found" : "Internal Server Error",
            message,
          });
      }
    },
  );
}
