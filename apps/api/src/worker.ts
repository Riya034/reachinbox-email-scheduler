import { loadEnv, logOAuthConfigHints } from "./config/env.js";
import { assertProductionSafeConfig } from "./config/production-guards.js";
import { createRuntime, closeRuntime } from "./lib/runtime.js";
import { createBullMqConnection } from "./lib/redis.js";
import { startEmailWorker } from "./workers/email.worker.js";

async function main(): Promise<void> {
  const env = loadEnv();
  assertProductionSafeConfig(env);
  logOAuthConfigHints(env);
  const ctx = await createRuntime(env);

  const workerConnection = createBullMqConnection(env);
  workerConnection.on("error", (err) =>
    console.error("BullMQ worker Redis error:", err.message),
  );
  await workerConnection.connect();

  const worker = startEmailWorker(
    workerConnection,
    ctx.rateLimitRedis,
    ctx.elasticsearch,
    ctx.env,
  );

  console.log(
    `[worker] Email worker running (concurrency=${env.EMAIL_QUEUE_CONCURRENCY})`,
  );

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down worker...`);
    await worker.close(true);
    await workerConnection.quit();
    await closeRuntime(ctx);
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
