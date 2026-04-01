import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { AuthService } from "./service";

// ─── Validation schemas ──────────────────────────────────────────────────────

const registerBodySchema = z.object({
  email: z.string().email(),
  name: z.string().min(2).max(100),
  password: z.string().min(8).max(128),
  role: z.nativeEnum(Role).optional(),
});

const loginBodySchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// ─── JWT payload type ────────────────────────────────────────────────────────

export interface JwtPayload {
  id: string;
  email: string;
  role: Role;
}

// ─── RBAC helper ────────────────────────────────────────────────────────────

export function requireRole(...roles: Role[]) {
  return async function (request: FastifyRequest, reply: FastifyReply) {
    await request.jwtVerify();
    const user = request.user as JwtPayload;
    if (!roles.includes(user.role)) {
      return reply.status(403).send({
        statusCode: 403,
        error: "Forbidden",
        message: `Required role: ${roles.join(" | ")}`,
      });
    }
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

export async function authRoutes(fastify: FastifyInstance) {
  // POST /auth/register
  fastify.post("/auth/register", async (request, reply) => {
    const result = registerBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
    }

    const { email, password, name, role } = result.data;

    const user = await AuthService.register(email, password, name, role);

    const token = fastify.jwt.sign(
      { id: user.id, email: user.email, role: user.role } satisfies JwtPayload
    );

    return reply.status(201).send({ token, user });
  });

  // POST /auth/login
  fastify.post("/auth/login", async (request, reply) => {
    const result = loginBodySchema.safeParse(request.body);
    if (!result.success) {
      return reply.status(400).send({
        statusCode: 400,
        error: "Bad Request",
        message: result.error.issues.map((i) => i.message).join("; "),
      });
    }

    const { email, password } = result.data;

    const user = await AuthService.login(email, password);

    const token = fastify.jwt.sign(
      { id: user.id, email: user.email, role: user.role } satisfies JwtPayload
    );

    return reply.send({ token, user });
  });

  // GET /auth/me
  fastify.get(
    "/auth/me",
    { preHandler: [fastify.authenticate] },
    async (request, reply) => {
      const payload = request.user as JwtPayload;

      const user = await prisma.user.findUnique({
        where: { id: payload.id },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      });

      if (!user) {
        return reply.status(404).send({
          statusCode: 404,
          error: "Not Found",
          message: "User not found",
        });
      }

      return reply.send({ user });
    }
  );
}
