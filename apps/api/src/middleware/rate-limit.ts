import type { Request, Response, NextFunction } from "express";
import { RateLimiterRedis } from "rate-limiter-flexible";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";

export function createRateLimitMiddleware(redis: Redis, env: Env) {
  const limiter = new RateLimiterRedis({
    storeClient: redis,
    keyPrefix: "rl:api",
    points: env.RATE_LIMIT_MAX,
    duration: Math.ceil(env.RATE_LIMIT_WINDOW_MS / 1000),
  });

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const key = req.ip ?? "unknown";
    try {
      await limiter.consume(key);
      next();
    } catch {
      res.status(429).json({ error: "Too many requests" });
    }
  };
}
