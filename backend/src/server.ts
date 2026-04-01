import Fastify from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import rateLimit from "@fastify/rate-limit";
import { config } from "./config";
import { prisma } from "./lib/prisma";
import { redis } from "./lib/redis";

// Route modules
import { authRoutes } from "./modules/auth/routes";
import { userRoutes } from "./modules/users/routes";
import { aiRoutes } from "./modules/ai/routes";
import { appRoutes } from "./modules/apps/routes";
import { dataRoutes } from "./modules/data-service/routes";
import { integrationRoutes } from "./modules/integrations/routes";
import { automationRoutes } from "./modules/automations/routes";
import { marketplaceRoutes } from "./modules/marketplace/routes";
import { policyRoutes } from "./modules/policy/routes";

// ─── Build Server ───────────────────────────────────────────

async function buildServer() {
  const fastify = Fastify({
    logger: {
      level: config.nodeEnv === "production" ? "info" : "debug",
    },
  });

  // ─── Plugins ────────────────────────────────────────────

  await fastify.register(cors, {
    origin: true,
    credentials: true,
  });

  await fastify.register(jwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.expiresIn },
  });

  await fastify.register(rateLimit, {
    max: 100,
    timeWindow: "1 minute",
  });

  // ─── Decorators ─────────────────────────────────────────

  fastify.decorate("authenticate", async (request: any, reply: any) => {
    await request.jwtVerify();
  });

  // ─── Health Check ───────────────────────────────────────

  fastify.get("/health", async () => {
    return {
      status: "ok",
      timestamp: new Date().toISOString(),
      version: "1.0.0",
      services: {
        database: await prisma.$queryRaw`SELECT 1`.then(() => "connected").catch(() => "disconnected"),
        redis: redis.status === "ready" ? "connected" : "disconnected",
      },
    };
  });

  // ─── API Routes ─────────────────────────────────────────

  await fastify.register(authRoutes, { prefix: "/api" });
  await fastify.register(userRoutes, { prefix: "/api" });
  await fastify.register(aiRoutes, { prefix: "/api" });
  await fastify.register(appRoutes, { prefix: "/api" });
  await fastify.register(dataRoutes, { prefix: "/api" });
  await fastify.register(integrationRoutes, { prefix: "/api" });
  await fastify.register(automationRoutes, { prefix: "/api" });
  await fastify.register(marketplaceRoutes, { prefix: "/api" });
  await fastify.register(policyRoutes, { prefix: "/api" });

  return fastify;
}

// ─── Start Server ───────────────────────────────────────────

async function main() {
  const server = await buildServer();

  try {
    await server.listen({ port: config.port, host: config.host });
    console.log(`
╔══════════════════════════════════════════════╗
║         AF Hub API Server v1.0.0             ║
║──────────────────────────────────────────────║
║  Port:     ${String(config.port).padEnd(33)}║
║  Env:      ${config.nodeEnv.padEnd(33)}║
║  Docs:     http://localhost:${config.port}/health${" ".repeat(10)}║
╚══════════════════════════════════════════════╝
    `);
  } catch (err) {
    server.log.error(err);
    process.exit(1);
  }
}

main();

export { buildServer };
