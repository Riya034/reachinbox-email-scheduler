import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import type { Client } from "@elastic/elasticsearch";
import type { Redis } from "ioredis";
import type { Queue } from "bullmq";
import type { Env } from "./config/env.js";
import { createRateLimitMiddleware } from "./middleware/rate-limit.js";
import { createRequireAuthMiddleware } from "./middleware/require-auth.js";
import { requestIdMiddleware } from "./middleware/request-id.js";
import { authRouter } from "./routes/auth.js";
import { campaignsRouter } from "./routes/campaigns.js";
import { emailsRouter } from "./routes/emails.js";
import { healthRouter } from "./routes/health.js";
import { senderAccountsRouter } from "./routes/sender-accounts.js";
import { slackCallbackRouter, slackRouter } from "./routes/slack.js";
import type { EmailJobData } from "./queues/email.types.js";

export function createApp(
  env: Env,
  redis: Redis,
  elasticsearch: Client,
  emailQueue: Queue<EmailJobData>,
  integrationTestUserId: string,
): express.Application {
  const app = express();

  if (env.NODE_ENV === "production") {
    app.set("trust proxy", 1);
  }

  app.use(
    cors({
      origin: env.WEB_URL,
      credentials: true,
    }),
  );
  app.use(requestIdMiddleware);
  app.use(cookieParser());
  app.use(express.json({ limit: "256kb" }));
  app.use(createRateLimitMiddleware(redis, env));

  const requireAuth = createRequireAuthMiddleware(env, integrationTestUserId);

  app.get("/", (_req, res) => {
    res.json({
      name: "ReachInbox Email Scheduler API",
      version: "0.1.0",
      docs: {
        health: "/health",
        auth: "/auth/google",
        emails: "/emails",
        senderAccounts: "/sender-accounts",
        campaigns: "/campaigns",
        bullBoard: env.BULL_BOARD_PATH,
      },
    });
  });

  app.use("/health", healthRouter(redis, elasticsearch));
  app.use("/auth", authRouter(env, redis));
  app.use("/auth/slack", slackCallbackRouter(env, redis));

  app.use("/slack", requireAuth, slackRouter(env, redis));
  app.use("/sender-accounts", requireAuth, senderAccountsRouter(env));
  app.use("/campaigns", requireAuth, campaignsRouter());
  app.use("/emails", requireAuth, emailsRouter(emailQueue, elasticsearch, env));

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath(env.BULL_BOARD_PATH);
  createBullBoard({
    queues: [new BullMQAdapter(emailQueue)],
    serverAdapter,
  });
  if (env.BULL_BOARD_REQUIRE_AUTH) {
    app.use(env.BULL_BOARD_PATH, requireAuth, serverAdapter.getRouter());
  } else {
    app.use(env.BULL_BOARD_PATH, serverAdapter.getRouter());
  }

  return app;
}
