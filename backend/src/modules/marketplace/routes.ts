import { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import { marketplaceService } from "./service";

interface JwtPayload {
  id: string;
  email: string;
  role: string;
}

export async function marketplaceRoutes(fastify: FastifyInstance) {
  const auth = async (request: FastifyRequest, reply: FastifyReply) => {
    await request.jwtVerify();
  };

  // GET /marketplace - list published apps
  fastify.get("/marketplace", { preHandler: [auth] }, async (request, reply) => {
    const query = request.query as any;
    const result = await marketplaceService.listPublishedApps({
      category: query.category,
      search: query.search,
      page: query.page ? parseInt(query.page) : undefined,
      limit: query.limit ? parseInt(query.limit) : undefined,
    });
    return result;
  });

  // GET /marketplace/featured - featured apps
  fastify.get("/marketplace/featured", { preHandler: [auth] }, async (request, reply) => {
    const query = request.query as any;
    const limit = query.limit ? parseInt(query.limit) : 6;
    const apps = await marketplaceService.getFeaturedApps(limit);
    return { data: apps };
  });

  // GET /marketplace/stats - marketplace statistics
  fastify.get("/marketplace/stats", { preHandler: [auth] }, async (request, reply) => {
    const stats = await marketplaceService.getStats();
    return stats;
  });

  // GET /marketplace/:slug - get published app details
  fastify.get("/marketplace/:slug", { preHandler: [auth] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    try {
      const app = await marketplaceService.getPublishedApp(slug);
      return app;
    } catch (err: any) {
      return reply.status(404).send({ error: "App not found in marketplace" });
    }
  });

  // POST /marketplace/:slug/clone - clone app to user workspace
  fastify.post("/marketplace/:slug/clone", { preHandler: [auth] }, async (request, reply) => {
    const { slug } = request.params as { slug: string };
    const user = (request as any).user as JwtPayload;
    try {
      const app = await marketplaceService.cloneApp(slug, user.id);
      return reply.status(201).send(app);
    } catch (err: any) {
      if (err.message.includes("not found")) {
        return reply.status(404).send({ error: err.message });
      }
      return reply.status(500).send({ error: "Failed to clone app" });
    }
  });
}
