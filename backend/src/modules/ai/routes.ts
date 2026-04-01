import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { AppCategory } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { aiOrchestrator } from "./orchestrator";
import { templateEngine } from "./templates";
import { JwtPayload } from "../auth/routes";

// ─── Validation schemas ───────────────────────────────────────────────────────

const chatBodySchema = z.object({
  messages: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1),
      }),
    )
    .min(1),
  conversationId: z.string().uuid().optional(),
  systemPrompt: z.string().optional(),
});

const generateCodeBodySchema = z.object({
  prompt: z.string().min(1),
  language: z.string().min(1),
});

const refineBodySchema = z.object({
  input: z.string().min(1),
});

const executeTemplateBodySchema = z.object({
  slug: z.string().min(1),
  variables: z.record(z.unknown()).default({}),
});

const listTemplatesQuerySchema = z.object({
  category: z.nativeEnum(AppCategory).optional(),
});

const createTemplateBodySchema = z.object({
  name: z.string().min(1).max(200),
  slug: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "slug must be kebab-case"),
  description: z.string().optional(),
  category: z.nativeEnum(AppCategory),
  schema: z.record(z.unknown()),
  promptTemplate: z.string().min(1),
  outputFormat: z.string().default("json"),
});

const generateTemplateBodySchema = z.object({
  description: z.string().min(10),
  category: z.nativeEnum(AppCategory),
});

// ─── Helper: validate body ────────────────────────────────────────────────────

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
      message: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
    });
    return null;
  }
  return result.data;
}

// ─── Routes ──────────────────────────────────────────────────────────────────

export async function aiRoutes(fastify: FastifyInstance): Promise<void> {
  // Shared auth preHandler
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  };

  // ── POST /ai/chat ─────────────────────────────────────────────────────────
  fastify.post(
    "/ai/chat",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(chatBodySchema, request.body, reply);
      if (!body) return;

      const user = request.user as JwtPayload;

      try {
        const responseText = await aiOrchestrator.chat(
          body.messages,
          body.systemPrompt,
        );

        // Persist / update conversation in the database.
        let conversationId = body.conversationId;

        if (conversationId) {
          // Verify the conversation belongs to this user.
          const existing = await prisma.conversation.findFirst({
            where: { id: conversationId, userId: user.id },
          });
          if (!existing) {
            return reply.status(404).send({
              statusCode: 404,
              error: "Not Found",
              message: "Conversation not found.",
            });
          }
        } else {
          // Create a new conversation seeded with the first user message.
          const firstUserMessage = body.messages.find((m) => m.role === "user");
          const title = firstUserMessage
            ? firstUserMessage.content.slice(0, 80)
            : "New conversation";

          const conversation = await prisma.conversation.create({
            data: {
              userId: user.id,
              title,
              status: "ACTIVE",
            },
          });
          conversationId = conversation.id;
        }

        // Persist all incoming messages + the assistant reply.
        await prisma.message.createMany({
          data: [
            ...body.messages.map((m) => ({
              conversationId: conversationId as string,
              role: m.role,
              content: m.content,
            })),
            {
              conversationId: conversationId as string,
              role: "assistant",
              content: responseText,
            },
          ],
          skipDuplicates: false,
        });

        return reply.status(200).send({
          conversationId,
          response: responseText,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /ai/generate-code ────────────────────────────────────────────────
  fastify.post(
    "/ai/generate-code",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(generateCodeBodySchema, request.body, reply);
      if (!body) return;

      try {
        const code = await aiOrchestrator.generateCode(body.prompt, body.language);
        return reply.status(200).send({ code });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /ai/refine ───────────────────────────────────────────────────────
  fastify.post(
    "/ai/refine",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(refineBodySchema, request.body, reply);
      if (!body) return;

      try {
        const refined = await aiOrchestrator.refinePrompt(body.input);
        return reply.status(200).send(refined);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /ai/conversations ─────────────────────────────────────────────────
  fastify.get(
    "/ai/conversations",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const user = request.user as JwtPayload;

      try {
        const conversations = await prisma.conversation.findMany({
          where: { userId: user.id },
          orderBy: { updatedAt: "desc" },
          select: {
            id: true,
            title: true,
            status: true,
            createdAt: true,
            updatedAt: true,
            _count: { select: { messages: true } },
          },
        });

        return reply.status(200).send(conversations);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── GET /ai/conversations/:id ─────────────────────────────────────────────
  fastify.get(
    "/ai/conversations/:id",
    { preHandler: auth },
    async (
      request: FastifyRequest<{ Params: { id: string } }>,
      reply: FastifyReply,
    ) => {
      const user = request.user as JwtPayload;
      const { id } = request.params;

      try {
        const conversation = await prisma.conversation.findFirst({
          where: { id, userId: user.id },
          include: {
            messages: {
              orderBy: { createdAt: "asc" },
            },
          },
        });

        if (!conversation) {
          return reply.status(404).send({
            statusCode: 404,
            error: "Not Found",
            message: "Conversation not found.",
          });
        }

        return reply.status(200).send(conversation);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /templates/execute ───────────────────────────────────────────────
  fastify.post(
    "/templates/execute",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(executeTemplateBodySchema, request.body, reply);
      if (!body) return;

      try {
        const result = await templateEngine.executeTemplate(body.slug, body.variables);
        return reply.status(200).send({ result });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        const statusCode = message.includes("not found") || message.includes("inactive") ? 404 : 500;
        return reply.status(statusCode).send({ statusCode, error: statusCode === 404 ? "Not Found" : "Internal Server Error", message });
      }
    },
  );

  // ── GET /templates ────────────────────────────────────────────────────────
  fastify.get(
    "/templates",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const query = listTemplatesQuerySchema.safeParse(request.query);
      if (!query.success) {
        return reply.status(400).send({
          statusCode: 400,
          error: "Bad Request",
          message: query.error.issues.map((i) => i.message).join("; "),
        });
      }

      try {
        const templates = await templateEngine.listTemplates(query.data.category);
        return reply.status(200).send(templates);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /templates ───────────────────────────────────────────────────────
  fastify.post(
    "/templates",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(createTemplateBodySchema, request.body, reply);
      if (!body) return;

      try {
        const template = await templateEngine.createTemplate(body);
        return reply.status(201).send(template);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        // Prisma unique constraint violation
        if (message.includes("Unique constraint")) {
          return reply.status(409).send({
            statusCode: 409,
            error: "Conflict",
            message: `A template with slug "${body.slug}" already exists.`,
          });
        }
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );

  // ── POST /templates/generate ──────────────────────────────────────────────
  fastify.post(
    "/templates/generate",
    { preHandler: auth },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const body = parseBody(generateTemplateBodySchema, request.body, reply);
      if (!body) return;

      try {
        const definition = await templateEngine.generateFromDescription(
          body.description,
          body.category,
        );
        return reply.status(200).send(definition);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Internal error";
        return reply.status(500).send({ statusCode: 500, error: "Internal Server Error", message });
      }
    },
  );
}
