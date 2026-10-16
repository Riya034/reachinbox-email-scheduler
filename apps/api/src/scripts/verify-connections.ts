import { loadEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { Redis } from "ioredis";
import { createElasticsearchClient, ensureEmailsIndex } from "../lib/elasticsearch.js";
import { createEmailQueue, EMAIL_QUEUE_NAME } from "../queues/email.queue.js";

async function verify(): Promise<void> {
  const env = loadEnv();
  const results: { service: string; ok: boolean; detail?: string }[] = [];

  try {
    await prisma.$queryRaw`SELECT 1`;
    results.push({ service: "PostgreSQL (Prisma)", ok: true });
  } catch (e) {
    results.push({
      service: "PostgreSQL (Prisma)",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const redis = new Redis(env.REDIS_URL, {
    maxRetriesPerRequest: 1,
    connectTimeout: 5_000,
    lazyConnect: true,
    retryStrategy: () => null,
  });
  redis.on("error", () => {
    /* expected when Redis is down during verify */
  });
  let redisOk = false;
  try {
    await redis.connect();
    const pong = await redis.ping();
    redisOk = pong === "PONG";
    results.push({
      service: "Redis",
      ok: redisOk,
      detail: pong,
    });
  } catch (e) {
    results.push({
      service: "Redis",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  const es = createElasticsearchClient(env);
  try {
    const health = await es.cluster.health();
    await ensureEmailsIndex(es);
    results.push({
      service: "Elasticsearch",
      ok: true,
      detail: `status=${health.status}`,
    });
  } catch (e) {
    results.push({
      service: "Elasticsearch",
      ok: false,
      detail: e instanceof Error ? e.message : String(e),
    });
  }

  if (redisOk) {
    try {
      const queue = createEmailQueue(redis);
      const counts = await queue.getJobCounts();
      results.push({
        service: `BullMQ (${EMAIL_QUEUE_NAME})`,
        ok: true,
        detail: JSON.stringify(counts),
      });
      await queue.close();
    } catch (e) {
      results.push({
        service: "BullMQ",
        ok: false,
        detail: e instanceof Error ? e.message : String(e),
      });
    }
  } else {
    results.push({
      service: `BullMQ (${EMAIL_QUEUE_NAME})`,
      ok: false,
      detail: "skipped (Redis unavailable)",
    });
  }

  console.log("\n=== Connection verification ===\n");
  for (const r of results) {
    const icon = r.ok ? "PASS" : "FAIL";
    console.log(`[${icon}] ${r.service}${r.detail ? ` — ${r.detail}` : ""}`);
  }

  if (redis.status !== "end") {
    redis.disconnect();
  }
  await prisma.$disconnect();

  const allOk = results.every((r) => r.ok);
  if (!allOk) {
    process.exit(1);
  }
}

verify().catch((err) => {
  console.error(err);
  process.exit(1);
});
