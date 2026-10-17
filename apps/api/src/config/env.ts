import { config } from "dotenv";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/** Monorepo root and API package root — independent of `process.cwd()`. */
const configDir = dirname(fileURLToPath(import.meta.url));
const apiPackageRoot = resolve(configDir, "../..");
const monorepoRoot = resolve(apiPackageRoot, "../..");

const loadedEnvFiles: string[] = [];

/** Keys that are often left blank in apps/api/.env but set in the repo root .env */
const MERGE_SENSITIVE_KEYS = [
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "SLACK_CLIENT_ID",
  "SLACK_CLIENT_SECRET",
  "SLACK_CALLBACK_URL",
  "TOKEN_ENCRYPTION_KEY",
  "INTEGRATION_TEST_AUTH_SECRET",
] as const;

function clearEmptySensitiveEnvPlaceholders(): void {
  for (const key of MERGE_SENSITIVE_KEYS) {
    if (process.env[key] === "") {
      delete process.env[key];
    }
  }
}

function loadEnvFiles(): void {
  clearEmptySensitiveEnvPlaceholders();

  const isProduction = process.env.NODE_ENV === "production";
  const apiEnvPath = resolve(apiPackageRoot, ".env");
  const rootEnvPath = resolve(monorepoRoot, ".env");

  if (existsSync(apiEnvPath)) {
    const result = config({ path: apiEnvPath, override: false });
    if (result.error) {
      console.warn(`[env] Could not read ${apiEnvPath}: ${result.error.message}`);
    } else {
      loadedEnvFiles.push(apiEnvPath);
    }
  }

  // Blank lines in apps/api/.env must not block real values from the repo root or the host.
  clearEmptySensitiveEnvPlaceholders();

  if (existsSync(rootEnvPath)) {
    const result = config({
      path: rootEnvPath,
      // Production/host env wins; root .env only fills unset keys.
      override: !isProduction,
    });
    if (result.error) {
      console.warn(`[env] Could not read ${rootEnvPath}: ${result.error.message}`);
    } else {
      loadedEnvFiles.push(rootEnvPath);
    }
  }

  clearEmptySensitiveEnvPlaceholders();
}

loadEnvFiles();

const trimmedOptional = z
  .string()
  .optional()
  .default("")
  .transform((v) => v.trim());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  API_PORT: z.coerce.number().default(3001),
  WEB_URL: z.string().url().default("http://localhost:5173"),
  API_URL: z.string().url().default("http://localhost:3001"),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().min(1),
  ELASTICSEARCH_URL: z.string().url(),
  EMAIL_QUEUE_CONCURRENCY: z.coerce.number().int().positive().default(5),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60000),
  BULL_BOARD_PATH: z.string().default("/admin/queues"),
  /** When true (default in production), Bull Board requires an authenticated session */
  BULL_BOARD_REQUIRE_AUTH: z
    .union([z.literal("true"), z.literal("false"), z.string()])
    .optional()
    .transform((v) => v === "true"),
  SMTP_HOST: z.string().default("smtp.ethereal.email"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  ETHEREAL_USER: trimmedOptional,
  ETHEREAL_PASS: trimmedOptional,
  SMTP_FROM: z.preprocess(
    (val) => (typeof val === "string" && val.trim() === "" ? undefined : val),
    z.string().email().optional(),
  ),
  DEV_SCHEDULER_USER_EMAIL: z.string().email().default("scheduler@reachinbox.local"),
  SENDER_DEFAULT_HOURLY_LIMIT: z.coerce.number().int().positive().default(100),
  SENDER_DEFAULT_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
  GOOGLE_CLIENT_ID: trimmedOptional,
  GOOGLE_CLIENT_SECRET: trimmedOptional,
  GOOGLE_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3001/auth/google/callback"),
  SESSION_SECRET: z.string().min(32).default(
    "dev-only-change-me-use-32-char-secret-min",
  ),
  COOKIE_SECURE: z
    .union([z.literal("true"), z.literal("false"), z.string()])
    .optional()
    .transform((v) => v === "true"),
  /** When set, allows `X-Integration-Test-Auth` header for automated tests only */
  INTEGRATION_TEST_AUTH_SECRET: trimmedOptional,
  SLACK_CLIENT_ID: trimmedOptional,
  SLACK_CLIENT_SECRET: trimmedOptional,
  SLACK_CALLBACK_URL: z
    .string()
    .url()
    .default("http://localhost:3001/auth/slack/callback"),
  TOKEN_ENCRYPTION_KEY: z.string().min(32).default(
    "dev-token-encryption-key-change-in-production-min-32",
  ),
});

export type Env = z.infer<typeof envSchema>;

export function getLoadedEnvFilePaths(): readonly string[] {
  return loadedEnvFiles;
}

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Environment validation failed");
  }
  const data = parsed.data;
  const cookieSecure =
    data.COOKIE_SECURE ?? data.NODE_ENV === "production";
  const bullBoardRequireAuth =
    data.BULL_BOARD_REQUIRE_AUTH ?? data.NODE_ENV === "production";
  return {
    ...data,
    COOKIE_SECURE: cookieSecure,
    BULL_BOARD_REQUIRE_AUTH: bullBoardRequireAuth,
  };
}

export function logEnvSourcesOnce(env: Env): void {
  if (env.NODE_ENV !== "development" || loadedEnvFiles.length === 0) {
    return;
  }
  console.log(`[env] Loaded ${loadedEnvFiles.length} file(s):`);
  for (const p of loadedEnvFiles) {
    console.log(`  - ${p}`);
  }
}

export function logOAuthConfigHints(env: Env): void {
  const googleOk = Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
  const slackOk = Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
  const encOk = Boolean(env.TOKEN_ENCRYPTION_KEY && env.TOKEN_ENCRYPTION_KEY.length >= 32);
  if (!googleOk) {
    console.warn("[env] Google OAuth is not configured (missing client id/secret).");
  }
  if (!slackOk) {
    console.warn("[env] Slack OAuth is not configured (missing client id/secret).");
  }
  if (!encOk) {
    console.warn("[env] TOKEN_ENCRYPTION_KEY is missing or too short.");
  }
}
