import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertProductionSafeConfig } from "../config/production-guards.js";
import type { Env } from "../config/env.js";

function prodEnv(overrides: Partial<Env> = {}): Env {
  return {
    NODE_ENV: "production",
    API_PORT: 3001,
    WEB_URL: "http://localhost:5173",
    API_URL: "http://localhost:3001",
    DATABASE_URL: "postgresql://x",
    REDIS_URL: "redis://localhost",
    ELASTICSEARCH_URL: "http://localhost:9200",
    EMAIL_QUEUE_CONCURRENCY: 5,
    RATE_LIMIT_MAX: 100,
    RATE_LIMIT_WINDOW_MS: 60_000,
    BULL_BOARD_PATH: "/admin/queues",
    BULL_BOARD_REQUIRE_AUTH: true,
    SMTP_HOST: "smtp.ethereal.email",
    SMTP_PORT: 587,
    ETHEREAL_USER: "",
    ETHEREAL_PASS: "",
    DEV_SCHEDULER_USER_EMAIL: "scheduler@reachinbox.local",
    SENDER_DEFAULT_HOURLY_LIMIT: 100,
    SENDER_DEFAULT_MIN_DELAY_MS: 1000,
    GOOGLE_CLIENT_ID: "",
    GOOGLE_CLIENT_SECRET: "",
    GOOGLE_CALLBACK_URL: "http://localhost:3001/auth/google/callback",
    SESSION_SECRET: "a".repeat(48),
    COOKIE_SECURE: true,
    INTEGRATION_TEST_AUTH_SECRET: "",
    SLACK_CLIENT_ID: "",
    SLACK_CLIENT_SECRET: "",
    SLACK_CALLBACK_URL: "http://localhost:3001/auth/slack/callback",
    TOKEN_ENCRYPTION_KEY: "b".repeat(48),
    ...overrides,
  } as Env;
}

describe("assertProductionSafeConfig", () => {
  it("allows secure production config", () => {
    assertProductionSafeConfig(prodEnv());
  });

  it("rejects default session secret", () => {
    assert.throws(() =>
      assertProductionSafeConfig(
        prodEnv({ SESSION_SECRET: "dev-only-change-me-use-32-char-secret-min" }),
      ),
    );
  });

  it("rejects integration test bypass secret in production", () => {
    assert.throws(() =>
      assertProductionSafeConfig(
        prodEnv({ INTEGRATION_TEST_AUTH_SECRET: "test-secret" }),
      ),
    );
  });
});
