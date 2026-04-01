import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { prisma } from "../../lib/prisma";
import { requireRole } from "../auth/routes";
import { Role } from "@prisma/client";

interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

export async function userRoutes(fastify: FastifyInstance) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  };

  const adminOnly = requireRole(Role.ADMIN);

  // GET /users - list all users (ADMIN only)
  fastify.get("/users", { preHandler: [adminOnly] }, async (request, reply) => {
    const query = request.query as any;
    const page = parseInt(query.page || "1");
    const limit = parseInt(query.limit || "20");
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.role) where.role = query.role;
    if (query.active !== undefined) where.active = query.active === "true";
    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: "insensitive" } },
        { email: { contains: query.search, mode: "insensitive" } },
      ];
    }

    const [data, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          active: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      prisma.user.count({ where }),
    ]);

    return { data, meta: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  });

  // GET /users/:id - get user by id
  fastify.get("/users/:id", { preHandler: [auth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtPayload;

    // Users can only view themselves unless ADMIN
    if (user.id !== id && user.role !== "ADMIN") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const found = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { apps: true, automations: true } },
      },
    });

    if (!found) return reply.status(404).send({ error: "User not found" });
    return found;
  });

  // PUT /users/:id - update user (ADMIN or self)
  fastify.put("/users/:id", { preHandler: [auth] }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const user = (request as any).user as JwtPayload;

    // Only ADMIN can change role or active status
    const body = request.body as any;
    if (user.id !== id && user.role !== "ADMIN") {
      return reply.status(403).send({ error: "Forbidden" });
    }

    const updateData: any = {};
    if (body.name) updateData.name = body.name;

    // Only ADMIN can change these
    if (user.role === "ADMIN") {
      if (body.role) updateData.role = body.role;
      if (body.active !== undefined) updateData.active = body.active;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        active: true,
        updatedAt: true,
      },
    });

    return updated;
  });

  // DELETE /users/:id - deactivate user (ADMIN only)
  fastify.delete("/users/:id", { preHandler: [adminOnly] }, async (request, reply) => {
    const { id } = request.params as { id: string };

    await prisma.user.update({
      where: { id },
      data: { active: false },
    });

    return reply.status(204).send();
  });
}
