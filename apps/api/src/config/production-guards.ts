import type { Env } from "./env.js";

const INSECURE_SESSION_SECRETS = new Set([
  "dev-only-change-me-use-32-char-secret-min",
  "change-me-in-production-use-long-random-string-min-32-chars",
]);

const INSECURE_TOKEN_KEYS = new Set([
  "dev-token-encryption-key-change-in-production-min-32",
  "change-me-token-encryption-key-min-32-chars",
]);

/**
 * Fail fast in production when obvious insecure defaults are still in use.
 */
export function assertProductionSafeConfig(env: Env): void {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const errors: string[] = [];

  if (INSECURE_SESSION_SECRETS.has(env.SESSION_SECRET)) {
    errors.push("SESSION_SECRET must be a unique random value in production");
  }
  if (INSECURE_TOKEN_KEYS.has(env.TOKEN_ENCRYPTION_KEY)) {
    errors.push("TOKEN_ENCRYPTION_KEY must be a unique random value in production");
  }
  if (env.INTEGRATION_TEST_AUTH_SECRET) {
    errors.push(
      "INTEGRATION_TEST_AUTH_SECRET must be unset in production (test auth bypass)",
    );
  }

  if (errors.length > 0) {
    throw new Error(`Unsafe production configuration:\n- ${errors.join("\n- ")}`);
  }
}
