import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Request, Response } from "express";
import { EmailStatus } from "@prisma/client";
import { loadEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { createRequireAuthMiddleware } from "../middleware/require-auth.js";

const API = process.env.API_URL ?? "http://localhost:3001";

async function apiReachable(): Promise<boolean> {
  try {
    const res = await fetch(`${API}/health`, { signal: AbortSignal.timeout(2000) });
    return res.ok;
  } catch {
    return false;
  }
}

describe("user data isolation (Postgres scoping)", () => {
  it("does not return another user's scheduled email by id + userId", async () => {
    const other = await prisma.user.create({
      data: { email: `iso-other-${Date.now()}@example.com`, name: "Other" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: other.id,
        label: "iso-sender",
        fromEmail: "other@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });
    const email = await prisma.scheduledEmail.create({
      data: {
        userId: other.id,
        senderAccountId: sender.id,
        to: "victim@example.com",
        subject: "Private",
        body: "Secret",
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
      },
    });

    const intruderId = `intruder-${Date.now()}`;
    const row = await prisma.scheduledEmail.findFirst({
      where: { id: email.id, userId: intruderId },
    });
    assert.equal(row, null);

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("does not return another user's sender account by id + userId", async () => {
    const owner = await prisma.user.create({
      data: { email: `iso-owner-${Date.now()}@example.com`, name: "Owner" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: owner.id,
        label: "private-sender",
        fromEmail: "owner@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });

    const row = await prisma.senderAccount.findFirst({
      where: { id: sender.id, userId: "wrong-user" },
    });
    assert.equal(row, null);

    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: owner.id } });
  });
});

describe("integration test auth bypass", () => {
  it("is disabled when NODE_ENV is production", () => {
    let statusCode = 0;
    const mw = createRequireAuthMiddleware(
      {
        NODE_ENV: "production",
        INTEGRATION_TEST_AUTH_SECRET: "test-secret",
        SESSION_SECRET: "session-secret-at-least-32-chars-long",
      } as ReturnType<typeof loadEnv>,
      "integration-user-id",
    );

    const req = {
      get: (name: string) =>
        name === "X-Integration-Test-Auth" ? "test-secret" : undefined,
      cookies: {},
    } as Request;

    const res = {
      status(code: number) {
        statusCode = code;
        return this;
      },
      json() {
        return this;
      },
    } as Response;

    let nextCalled = false;
    mw(req, res, () => {
      nextCalled = true;
    });

    assert.equal(nextCalled, false);
    assert.equal(statusCode, 401);
  });
});

describe("API user isolation (requires running API)", () => {
  it("cannot read another user's email by id", async (t) => {
    if (!(await apiReachable())) {
      t.skip("API not running on " + API);
      return;
    }

    const env = loadEnv();
    const secret = env.INTEGRATION_TEST_AUTH_SECRET;
    if (!secret) {
      t.skip("INTEGRATION_TEST_AUTH_SECRET not set");
      return;
    }

    const other = await prisma.user.create({
      data: { email: `iso-api-${Date.now()}@example.com`, name: "Other" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: other.id,
        label: "iso-api-sender",
        fromEmail: "other@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });
    const email = await prisma.scheduledEmail.create({
      data: {
        userId: other.id,
        senderAccountId: sender.id,
        to: "victim@example.com",
        subject: "Private",
        body: "Secret",
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
      },
    });

    const res = await fetch(`${API}/emails/${email.id}`, {
      headers: {
        "X-Integration-Test-Auth": secret!,
      },
    });
    assert.equal(res.status, 404);

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: other.id } });
  });

  it("rejects unauthenticated requests", async (t) => {
    if (!(await apiReachable())) {
      t.skip("API not running on " + API);
      return;
    }
    const res = await fetch(`${API}/emails?status=scheduled`);
    assert.equal(res.status, 401);
  });
});
