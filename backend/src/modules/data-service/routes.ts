import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { dataService, ColumnDef } from "./service";
import { JwtPayload } from "../auth/routes";

// ─── Zod schemas ──────────────────────────────────────────────────────────────

const columnDefSchema = z.object({
  name: z
    .string()
    .min(1)
    .max(63)
    .regex(
      /^[a-zA-Z_][a-zA-Z0-9_]*$/,
      "Column name must start with a letter or underscore and contain only alphanumeric characters and underscores.",
    ),
  type: z.string().min(1),
  nullable: z.boolean().optional(),
  defaultValue: z.string().optional(),
});

const createSchemaBodySchema = z.object({
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  columns: z.array(columnDefSchema).min(1, "At least one column is required."),
});

const generateSchemaBodySchema = z.object({
  description: z
    .string()
    .min(10, "Please provide a more detailed description (min 10 characters)."),
});

const insertRowBodySchema = z
  .record(z.unknown())
  .refine((v) => Object.keys(v).length > 0, {
    message: "Request body must contain at least one field.",
  });

const updateRowBodySchema = z
  .record(z.unknown())
  .refine((v) => Object.keys(v).length > 0, {
    message: "Request body must contain at least one field to update.",
  });

const queryRowsQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(1000).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  orderBy: z
    .string()
    .regex(
      /^[a-zA-Z0-9_]+(:(asc|desc))?$/i,
      'orderBy must be in the format "column" or "column:asc" or "column:desc".',
    )
    .optional(),
});

// ─── Helper: uniform body parser ─────────────────────────────────────────────

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

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(error: unknown, reply: FastifyReply): void {
  const message =
    error instanceof Error ? error.message : "Internal server error.";

  if (
    message.includes("not found") ||
    message.includes("Not found")
  ) {
    reply.status(404).send({ statusCode: 404, error: "Not Found", message });
    return;
  }

  if (
    message.includes("Unique constraint") ||
    message.toLowerCase().includes("already exists")
  ) {
    reply
      .status(409)
      .send({ statusCode: 409, error: "Conflict", message });
    return;
  }

  reply
    .status(500)
    .send({ statusCode: 500, error: "Internal Server Error", message });
}

// ─── Routes ───────────────────────────────────────────────────────────────────

export async function dataRoutes(fastify: FastifyInstance): Promise<void> {
  // Shared auth preHandler — all data-service routes require a valid JWT.
  const auth = async (request: FastifyRequest, _reply: FastifyReply) => {
    await request.jwtVerify();
  };

  // ── POST /data/schemas/generate ───────────────────────────────────────────
  // Registered before /data/schemas to avoid the :slug wildcard matching
  // the literal segment "generate".
  fastify.post(
    "/data/schemas/generate",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(generateSchemaBodySchema, request.body, reply);
      if (!body) return;

      try {
        const columns = await dataService.generateSchemaFromDescription(
          body.description,
        );
        return reply.status(200).send({ columns });
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── POST /data/schemas ────────────────────────────────────────────────────
  fastify.post(
    "/data/schemas",
    { preHandler: [auth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createSchemaBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const schema = await dataService.createSchema({
          name: body.name,
          description: body.description,
          columns: body.columns as ColumnDef[],
          authorId: user.id,
        });
        return reply.status(201).send(schema);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── GET /data/schemas ─────────────────────────────────────────────────────
  fastify.get(
    "/data/schemas",
    { preHandler: [auth] },
    async (_request: FastifyRequest, reply: FastifyReply) => {
      try {
        const schemas = await dataService.listSchemas();
        return reply.status(200).send(schemas);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── GET /data/schemas/:slug ───────────────────────────────────────────────
  fastify.get(
    "/data/schemas/:slug",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        const schema = await dataService.getSchema(request.params.slug);
        return reply.status(200).send(schema);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── DELETE /data/schemas/:slug ────────────────────────────────────────────
  fastify.delete(
    "/data/schemas/:slug",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { slug: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        await dataService.deleteSchema(request.params.slug);
        return reply.status(204).send();
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── POST /data/:tableName/rows ────────────────────────────────────────────
  fastify.post(
    "/data/:tableName/rows",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { tableName: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(insertRowBodySchema, request.body, reply);
      if (!body) return;

      try {
        const row = await dataService.insertRow(
          request.params.tableName,
          body as Record<string, unknown>,
        );
        return reply.status(201).send(row);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── GET /data/:tableName/rows ─────────────────────────────────────────────
  fastify.get(
    "/data/:tableName/rows",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { tableName: string } }>,
      reply: FastifyReply,
    ) => {
      // Parse reserved pagination/ordering params; remaining query params
      // become equality filters for the WHERE clause.
      const parsedQuery = queryRowsQuerySchema.safeParse(request.query);
      if (!parsedQuery.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: parsedQuery.error.issues
            .map((i) => `${i.path.join(".")}: ${i.message}`)
            .join("; "),
        });
      }

      const { limit, offset, orderBy } = parsedQuery.data;

      // Extract extra query params as column filters (exclude reserved keys).
      const reservedKeys = new Set(["limit", "offset", "orderBy"]);
      const rawQuery = request.query as Record<string, unknown>;
      const where: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(rawQuery)) {
        if (!reservedKeys.has(key)) {
          where[key] = value;
        }
      }

      try {
        const result = await dataService.queryRows(
          request.params.tableName,
          {
            where: Object.keys(where).length > 0 ? where : undefined,
            limit,
            offset,
            orderBy,
          },
        );
        return reply.status(200).send(result);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── PUT /data/:tableName/rows/:id ─────────────────────────────────────────
  fastify.put(
    "/data/:tableName/rows/:id",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { tableName: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      const body = parseBody(updateRowBodySchema, request.body, reply);
      if (!body) return;

      try {
        const row = await dataService.updateRow(
          request.params.tableName,
          request.params.id,
          body as Record<string, unknown>,
        );
        return reply.status(200).send(row);
      } catch (error) {
        handleError(error, reply);
      }
    },
  );

  // ── DELETE /data/:tableName/rows/:id ──────────────────────────────────────
  fastify.delete(
    "/data/:tableName/rows/:id",
    { preHandler: [auth] },
    async (
      request: FastifyRequest<{ Params: { tableName: string; id: string } }>,
      reply: FastifyReply,
    ) => {
      try {
        await dataService.deleteRow(
          request.params.tableName,
          request.params.id,
        );
        return reply.status(204).send();
      } catch (error) {
        handleError(error, reply);
      }
    },
  );
}
