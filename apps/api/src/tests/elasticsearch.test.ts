import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailStatus } from "@prisma/client";
import {
  buildEmailIndexDocument,
  indexScheduledEmailSafe,
} from "../services/email-index.service.js";
import {
  buildEmailSearchQuery,
  statusFilterForVariant,
} from "../services/email-search.service.js";
import { ElasticsearchSearchUnavailableError } from "../services/email-search.service.js";

describe("email index document", () => {
  it("includes sender and campaign fields", () => {
    const doc = buildEmailIndexDocument({
      id: "e1",
      userId: "u1",
      campaignId: "c1",
      senderAccountId: "s1",
      to: "a@b.com",
      subject: "Hello",
      body: "Body",
      scheduledAt: new Date("2026-01-01T10:00:00Z"),
      sentAt: null,
      lastPostponedAt: null,
      sequenceOrder: 0,
      status: EmailStatus.QUEUED,
      smtpMessageId: null,
      errorMessage: null,
      attemptCount: 0,
      bullJobId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      senderAccount: { label: "main", fromEmail: "from@test.com" },
      campaign: { name: "Camp" },
    });
    assert.equal(doc.emailId, "e1");
    assert.equal(doc.senderLabel, "main");
    assert.equal(doc.campaignName, "Camp");
  });
});

describe("search query isolation", () => {
  it("filters by userId and scheduled statuses", () => {
    const { query } = buildEmailSearchQuery({
      userId: "user-a",
      q: "invoice",
      variant: "scheduled",
      limit: 10,
    });
    const must = (query.bool as { must: unknown[] }).must;
    assert.ok(
      must.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          (m as { term?: { userId: string } }).term?.userId === "user-a",
      ),
    );
    assert.ok(
      must.some(
        (m) =>
          typeof m === "object" &&
          m !== null &&
          Array.isArray((m as { terms?: { status: string[] } }).terms?.status),
      ),
    );
  });

  it("uses different status sets per variant", () => {
    const scheduled = statusFilterForVariant("scheduled");
    const sent = statusFilterForVariant("sent");
    assert.ok(scheduled.includes(EmailStatus.QUEUED));
    assert.ok(sent.includes(EmailStatus.SENT));
    assert.ok(!scheduled.includes(EmailStatus.SENT));
  });
});

describe("indexScheduledEmailSafe", () => {
  it("does not throw when Elasticsearch client fails", async () => {
    const { prisma } = await import("../lib/prisma.js");
    const user = await prisma.user.create({
      data: { email: `es-safe-${Date.now()}@example.com`, name: "ES Safe" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "es-test",
        fromEmail: "from@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });
    const email = await prisma.scheduledEmail.create({
      data: {
        userId: user.id,
        senderAccountId: sender.id,
        to: "to@test.com",
        subject: "Subj",
        body: "Body",
        scheduledAt: new Date(),
        status: EmailStatus.SCHEDULED,
      },
    });

    const failingClient = {
      index: async () => {
        throw new Error("es down");
      },
    };
    const ok = await indexScheduledEmailSafe(failingClient as never, email);
    assert.equal(ok, false);

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("search outage", () => {
  it("exposes typed unavailable error", () => {
    const err = new ElasticsearchSearchUnavailableError();
    assert.equal(err.name, "ElasticsearchSearchUnavailableError");
  });
});

describe("live elasticsearch (optional)", () => {
  it("cluster responds when docker is up", async () => {
    const { loadEnv } = await import("../config/env.js");
    const { createElasticsearchClient } = await import("../lib/elasticsearch.js");
    const env = loadEnv();
    const client = createElasticsearchClient(env);
    try {
      const health = await client.cluster.health();
      assert.ok(["green", "yellow", "red"].includes(String(health.status)));
    } catch {
      // ES not running in this environment — skip assertion
      return;
    }
  });
});
