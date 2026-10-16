import type { Client } from "@elastic/elasticsearch";
import type { Queue } from "bullmq";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import { ensureDefaultSenderForUser, ensureDevSchedulerUser } from "./bootstrap.js";
import { createElasticsearchClient, ensureEmailsIndex } from "./elasticsearch.js";
import { createBullMqConnection, createRedisConnection } from "./redis.js";
import { createEmailQueue } from "../queues/email.queue.js";
import type { EmailJobData } from "../queues/email.types.js";
import { reconcilePendingEmails } from "../services/email-scheduler.service.js";

export type RuntimeContext = {
  env: Env;
  redis: Redis;
  queueConnection: Redis;
  rateLimitRedis: Redis;
  elasticsearch: Client;
  emailQueue: Queue<EmailJobData>;
  devUserId: string;
  defaultSenderAccountId: string;
};

export async function createRuntime(env: Env): Promise<RuntimeContext> {
  const redis = createRedisConnection(env);
  redis.on("error", (err) => console.error("Redis error:", err.message));
  await redis.connect();

  const queueConnection = createBullMqConnection(env);
  queueConnection.on("error", (err) =>
    console.error("BullMQ queue Redis error:", err.message),
  );
  await queueConnection.connect();

  const rateLimitRedis = createBullMqConnection(env);
  rateLimitRedis.on("error", (err) =>
    console.error("Rate-limit Redis error:", err.message),
  );
  await rateLimitRedis.connect();

  const elasticsearch = createElasticsearchClient(env);
  await ensureEmailsIndex(elasticsearch);

  const emailQueue = createEmailQueue(queueConnection);
  const devUserId = await ensureDevSchedulerUser(env.DEV_SCHEDULER_USER_EMAIL);
  const defaultSenderAccountId = await ensureDefaultSenderForUser(devUserId, env);

  await reconcilePendingEmails(emailQueue, elasticsearch);

  return {
    env,
    redis,
    queueConnection,
    rateLimitRedis,
    elasticsearch,
    emailQueue,
    devUserId,
    defaultSenderAccountId,
  };
}

export async function closeRuntime(ctx: RuntimeContext): Promise<void> {
  await ctx.emailQueue.close();
  await ctx.rateLimitRedis.quit();
  await ctx.queueConnection.quit();
  await ctx.redis.quit();
}
