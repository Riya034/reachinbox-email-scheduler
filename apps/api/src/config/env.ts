import { config } from "dotenv";
import { resolve } from "node:path";
import { z } from "zod";

config({ path: resolve(process.cwd(), "../../.env") });
config({ path: resolve(process.cwd(), ".env") });

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
  SMTP_HOST: z.string().default("smtp.ethereal.email"),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  ETHEREAL_USER: z.string().optional().default(""),
  ETHEREAL_PASS: z.string().optional().default(""),
  SMTP_FROM: z.string().email().optional(),
  DEV_SCHEDULER_USER_EMAIL: z.string().email().default("scheduler@reachinbox.local"),
  SENDER_DEFAULT_HOURLY_LIMIT: z.coerce.number().int().positive().default(100),
  SENDER_DEFAULT_MIN_DELAY_MS: z.coerce.number().int().nonnegative().default(1000),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error("Invalid environment variables:", parsed.error.flatten().fieldErrors);
    throw new Error("Environment validation failed");
  }
  return parsed.data;
}
