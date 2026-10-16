import express from "express";
import cors from "cors";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Client } from "@elastic/elasticsearch";
import type { Redis } from "ioredis";
import type { Queue } from "bullmq";
import type { Env } from "./config/env.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { emailsRouter } from "./routes/emails.js";
import { healthRouter } from "./routes/health.js";
import { senderAccountsRouter } from "./routes/sender-accounts.js";
import type { EmailJobData } from "./queues/email.types.js";

export function createApp(
  env: Env,
  redis: Redis,
  elasticsearch: Client,
  emailQueue: Queue<EmailJobData>,
  devUserId: string,
  defaultSenderAccountId: string,
): express.Application {
  const app = express();

  app.use(
    cors({
      origin: env.WEB_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(createRateLimitMiddleware(redis, env));

  app.get("/", (_req, res) => {
    res.json({
      name: "ReachInbox Email Scheduler API",
      version: "0.1.0",
      docs: {
        health: "/health",
        emails: "/emails",
        senderAccounts: "/sender-accounts",
        campaigns: "/campaigns",
        bullBoard: env.BULL_BOARD_PATH,
      },
    });
  });

  app.use("/health", healthRouter(redis, elasticsearch));
  app.use("/sender-accounts", senderAccountsRouter(devUserId, env));
  app.use("/campaigns", campaignsRouter(devUserId));
  app.use(
    "/emails",
    emailsRouter(emailQueue, elasticsearch, devUserId, defaultSenderAccountId),
  );

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(env.BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });
  app.use(env.BULL_BOARD_PATH, serverAdapter.getRouter());

  return app;
}
