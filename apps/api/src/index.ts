import { loadEnv, logEnvSourcesOnce, logOAuthConfigHints } from "./config/env.js";
import { assertProductionSafeConfig } from "./config/production-guards.js";
import { createApp } from "./app.js";
import { createRuntime, closeRuntime } from "./lib/runtime.js";

async function main(): Promise<void> {
  const env = loadEnv();
  assertProductionSafeConfig(env);
  logEnvSourcesOnce(env);
  logOAuthConfigHints(env);
  const ctx = await createRuntime(env);

  const app = createApp(
    ctx.env,
    ctx.redis,
    ctx.elasticsearch,
    ctx.emailQueue,
    ctx.devUserId,
  );

  const server = app.listen(env.API_PORT, () => {
    console.log(`API listening on http://localhost:${env.API_PORT}`);
    console.log(`Bull Board: http://localhost:${env.API_PORT}${env.BULL_BOARD_PATH}`);
  });

  const shutdown = async (signal: string) => {
    console.log(`Received ${signal}, shutting down API...`);
    server.close();
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
