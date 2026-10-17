import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadEnv } from "../config/env.js";
import { createBullMqConnection } from "../lib/redis.js";
import {
  resetSenderRateLimits,
  tryAcquireSenderSendSlot,
} from "../lib/sender-rate-limit.js";

const TEST_SENDER = `rate-limit-concurrency-${Date.now()}`;

async function redisReachable(): Promise<boolean> {
  const env = loadEnv();
  const redis = createBullMqConnection(env);
  try {
    await redis.connect();
    await redis.ping();
    await redis.quit();
    return true;
  } catch {
    try {
      await redis.quit();
    } catch {
      /* ignore */
    }
    return false;
  }
}

describe("distributed sender rate limits (Redis)", () => {
  it("enforces hourly cap across parallel acquirers", async (t) => {
    if (!(await redisReachable())) {
      t.skip("Redis not available");
      return;
    }

    const env = loadEnv();
    const redis = createBullMqConnection(env);
    await redis.connect();
    await resetSenderRateLimits(redis, TEST_SENDER);

    const hourlyLimit = 3;
    const minDelayMs = 0;
    const attempts = 8;
    const results = await Promise.all(
      Array.from({ length: attempts }, () =>
        tryAcquireSenderSendSlot(redis, TEST_SENDER, hourlyLimit, minDelayMs),
      ),
    );

    const acquired = results.filter((r) => r.acquired).length;
    const postponed = results.filter((r) => !r.acquired);

    assert.equal(acquired, hourlyLimit);
    assert.equal(postponed.length, attempts - hourlyLimit);
    for (const p of postponed) {
      assert.ok(!p.acquired);
      assert.ok(p.retryAfterMs > 0);
    }

    await resetSenderRateLimits(redis, TEST_SENDER);
    await redis.quit();
  });

  it("enforces minimum delay between sends", async (t) => {
    if (!(await redisReachable())) {
      t.skip("Redis not available");
      return;
    }

    const env = loadEnv();
    const redis = createBullMqConnection(env);
    await redis.connect();
    await resetSenderRateLimits(redis, `${TEST_SENDER}-delay`);

    const senderId = `${TEST_SENDER}-delay`;
    const first = await tryAcquireSenderSendSlot(redis, senderId, 100, 500);
    assert.equal(first.acquired, true);

    const second = await tryAcquireSenderSendSlot(redis, senderId, 100, 500);
    assert.equal(second.acquired, false);
    if (!second.acquired) {
      assert.equal(second.reason, "min_delay");
      assert.ok(second.retryAfterMs > 0);
    }

    await resetSenderRateLimits(redis, senderId);
    await redis.quit();
  });
});
