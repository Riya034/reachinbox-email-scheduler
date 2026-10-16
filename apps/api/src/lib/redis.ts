import { Redis } from "ioredis";
import type { Env } from "../config/env.js";

export function createRedisConnection(env: Env): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}

/** Dedicated connection for BullMQ Queue/Worker (do not share with rate limiter). */
export function createBullMqConnection(env: Env): Redis {
  return new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
}
