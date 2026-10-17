import assert from "node:assert/strict";
import { describe, it, after } from "node:test";
import type { Redis } from "ioredis";
import { encryptSecret, decryptSecret } from "../lib/token-crypto.js";
import {
  consumeSlackOAuthState,
  createSlackOAuthState,
} from "../lib/slack-oauth.js";
import {
  getSlackApiClient,
  resetSlackApiClientFactory,
  setSlackApiClientFactory,
} from "../services/slack-api.js";
import { tryNotifySlackRateLimitPostponement } from "../services/slack-rate-limit-notify.service.js";
import { loadEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";

function createMemoryRedis(): Redis {
  const strings = new Map<string, string>();
  return {
    set: async (key: string, value: string, ...args: string[]) => {
      if (args[0] === "EX" && args[2] === "NX") {
        if (strings.has(key)) {
          return null;
        }
        strings.set(key, value);
        return "OK";
      }
      strings.set(key, value);
      return "OK";
    },
    get: async (key: string) => strings.get(key) ?? null,
    del: async (key: string) => (strings.delete(key) ? 1 : 0),
  } as unknown as Redis;
}

describe("token encryption", () => {
  it("round-trips secrets", () => {
    const key = "test-encryption-key-at-least-32-characters-long";
    const cipher = encryptSecret("xoxb-test-token", key);
    assert.notEqual(cipher, "xoxb-test-token");
    assert.equal(decryptSecret(cipher, key), "xoxb-test-token");
  });
});

describe("Slack OAuth state", () => {
  it("validates and consumes state once", async () => {
    const redis = createMemoryRedis();
    const state = await createSlackOAuthState(redis, "user-abc");
    const userId = await consumeSlackOAuthState(redis, state);
    assert.equal(userId, "user-abc");
    const again = await consumeSlackOAuthState(redis, state);
    assert.equal(again, null);
  });

  it("rejects invalid state", async () => {
    const redis = createMemoryRedis();
    assert.equal(await consumeSlackOAuthState(redis, "not-valid"), null);
  });
});

describe("Slack rate-limit notifications", () => {
  const env = loadEnv();

  it("deduplicates repeated postponements", async () => {
    const redis = createMemoryRedis();
    let postCount = 0;
    setSlackApiClientFactory(() => ({
      openDm: async () => ({ ok: true, data: "C123" }),
      postMessage: async () => {
        postCount += 1;
        return { ok: true, data: undefined };
      },
    }));

    const email = `slack-test-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: { email, name: "Slack Test" },
    });

    await prisma.slackConnection.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        slackUserId: "U_TEST",
        slackTeamId: "T_TEST",
        teamName: "Test Workspace",
        encryptedAccessToken: encryptSecret("xoxb-fake", env.TOKEN_ENCRYPTION_KEY),
        scopes: "chat:write",
      },
      update: {
        revokedAt: null,
        encryptedAccessToken: encryptSecret("xoxb-fake", env.TOKEN_ENCRYPTION_KEY),
      },
    });

    const base = {
      env,
      redis,
      userId: user.id,
      emailId: `email-dedupe-${Date.now()}`,
      senderLabel: "test-sender",
      fromEmail: "from@test.com",
      to: "to@test.com",
      subject: "Hello",
      reason: "min_delay" as const,
      retryAfterMs: 5_000,
    };

    await tryNotifySlackRateLimitPostponement(base);
    await tryNotifySlackRateLimitPostponement(base);
    assert.equal(postCount, 1);

    await prisma.slackConnection.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    resetSlackApiClientFactory();
  });

  it("marks connection revoked without throwing on invalid_auth", async () => {
    const redis = createMemoryRedis();
    setSlackApiClientFactory(() => ({
      openDm: async () => ({
        ok: false,
        error: "invalid_auth",
        revoked: true,
      }),
      postMessage: async () => ({ ok: true, data: undefined }),
    }));

    const email = `slack-revoke-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: { email, name: "Revoke Test" },
    });

    await prisma.slackConnection.create({
      data: {
        userId: user.id,
        slackUserId: "U_REV",
        slackTeamId: "T_REV",
        teamName: "Revoke WS",
        encryptedAccessToken: encryptSecret("xoxb-bad", env.TOKEN_ENCRYPTION_KEY),
        scopes: "chat:write",
      },
    });

    await tryNotifySlackRateLimitPostponement({
      env,
      redis,
      userId: user.id,
      emailId: `email-revoke-${Date.now()}`,
      senderLabel: "s",
      fromEmail: "a@b.com",
      to: "c@d.com",
      subject: "Subj",
      reason: "hourly_limit",
      retryAfterMs: 10_000,
    });

    const row = await prisma.slackConnection.findUnique({ where: { userId: user.id } });
    assert.ok(row?.revokedAt);

    await prisma.slackConnection.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
    resetSlackApiClientFactory();
  });
});

describe("Slack user isolation", () => {
  const env = loadEnv();

  it("stores connections per user", async () => {
    const u1 = await prisma.user.create({
      data: { email: `slack-iso-1-${Date.now()}@example.com`, name: "U1" },
    });
    const u2 = await prisma.user.create({
      data: { email: `slack-iso-2-${Date.now()}@example.com`, name: "U2" },
    });

    await prisma.slackConnection.create({
      data: {
        userId: u1.id,
        slackUserId: "U1SLACK",
        slackTeamId: "T1",
        teamName: "Team One",
        encryptedAccessToken: encryptSecret("tok1", env.TOKEN_ENCRYPTION_KEY),
        scopes: "chat:write",
      },
    });
    await prisma.slackConnection.create({
      data: {
        userId: u2.id,
        slackUserId: "U2SLACK",
        slackTeamId: "T2",
        teamName: "Team Two",
        encryptedAccessToken: encryptSecret("tok2", env.TOKEN_ENCRYPTION_KEY),
        scopes: "chat:write",
      },
    });

    const c1 = await prisma.slackConnection.findUnique({ where: { userId: u1.id } });
    const c2 = await prisma.slackConnection.findUnique({ where: { userId: u2.id } });
    assert.equal(c1?.teamName, "Team One");
    assert.equal(c2?.teamName, "Team Two");
    assert.notEqual(c1?.encryptedAccessToken, c2?.encryptedAccessToken);

    await prisma.slackConnection.deleteMany({ where: { userId: { in: [u1.id, u2.id] } } });
    await prisma.user.deleteMany({ where: { id: { in: [u1.id, u2.id] } } });
  });
});

describe("Slack API client factory", () => {
  after(() => {
    resetSlackApiClientFactory();
  });

  it("uses injected mock client", async () => {
    setSlackApiClientFactory(() => ({
      openDm: async () => ({ ok: true, data: "C999" }),
      postMessage: async () => ({ ok: true, data: undefined }),
    }));
    const client = getSlackApiClient("ignored");
    const dm = await client.openDm("U1");
    assert.equal(dm.ok && dm.data, "C999");
  });
});
