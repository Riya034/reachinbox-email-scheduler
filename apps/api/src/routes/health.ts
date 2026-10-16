import { Router } from "express";
import type { Client } from "@elastic/elasticsearch";
import type { Redis } from "ioredis";
import { prisma } from "../lib/prisma.js";

export function healthRouter(redis: Redis, elasticsearch: Client): Router {
  const router = Router();

  router.get("/", async (_req, res) => {
    const checks: Record<string, string> = {
      api: "ok",
      postgres: "unknown",
      redis: "unknown",
      elasticsearch: "unknown",
    };

    try {
      await prisma.$queryRaw`SELECT 1`;
      checks.postgres = "ok";
    } catch {
      checks.postgres = "error";
    }

    try {
      const pong = await redis.ping();
      checks.redis = pong === "PONG" ? "ok" : "error";
    } catch {
      checks.redis = "error";
    }

    try {
      const health = await elasticsearch.cluster.health();
      checks.elasticsearch = health.status === "red" ? "degraded" : "ok";
    } catch {
      checks.elasticsearch = "error";
    }

    const healthy = Object.values(checks).every((v) => v === "ok" || v === "degraded");
    res.status(healthy ? 200 : 503).json({
      status: healthy ? "healthy" : "unhealthy",
      checks,
      timestamp: new Date().toISOString(),
    });
  });

  return router;
}
