import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailStatus } from "@prisma/client";
import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { prisma } from "../lib/prisma.js";
import { emailJobId, type EmailJobData } from "../queues/email.types.js";
import { reconcilePendingEmails } from "../services/email-scheduler.service.js";

const es = {} as Client;

function mockQueue(
  jobs: Map<string, { state: string; returnvalue?: unknown }>,
): Queue<EmailJobData> {
  return {
    getJob: async (id: string) => {
      const entry = jobs.get(id);
      if (!entry) {
        return null;
      }
      return {
        getState: async () => entry.state,
        returnvalue: entry.returnvalue,
        retry: async () => {
          entry.state = "waiting";
        },
      };
    },
    add: async () => ({}),
  } as unknown as Queue<EmailJobData>;
}

async function postgresReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("reconcilePendingEmails recovery", () => {
  it("recovers enqueue-failed rows without SMTP proof", async (t) => {
    if (!(await postgresReachable())) {
      t.skip("Postgres not available");
      return;
    }
    const user = await prisma.user.create({
      data: { email: `recon-${Date.now()}@example.com`, name: "R" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "r-sender",
        fromEmail: "f@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });
    const email = await prisma.scheduledEmail.create({
      data: {
        userId: user.id,
        senderAccountId: sender.id,
        to: "t@test.com",
        subject: "Enqueue failed",
        body: "b",
        scheduledAt: new Date(),
        status: EmailStatus.FAILED,
        errorMessage: "Failed to enqueue send job: redis down",
        smtpMessageId: null,
      },
    });

    const jobs = new Map<string, { state: string }>();
    const queue = {
      getJob: async (id: string) => {
        const entry = jobs.get(id);
        if (!entry) {
          return null;
        }
        return {
          getState: async () => entry.state,
          retry: async () => {
            entry.state = "waiting";
          },
        };
      },
      add: async (_name: string, data: { emailId: string }) => {
        jobs.set(emailJobId(data.emailId), { state: "delayed" });
        return {};
      },
    } as unknown as Queue<EmailJobData>;

    const restored = await reconcilePendingEmails(queue, es);
    assert.ok(restored >= 1);

    const row = await prisma.scheduledEmail.findUniqueOrThrow({
      where: { id: email.id },
    });
    assert.equal(row.status, EmailStatus.QUEUED);

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });

  it("heals SENDING when Bull job completed with messageId (no resend)", async (t) => {
    if (!(await postgresReachable())) {
      t.skip("Postgres not available");
      return;
    }
    const user = await prisma.user.create({
      data: { email: `recon-sent-${Date.now()}@example.com`, name: "R" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "r-sender-2",
        fromEmail: "f@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });
    const email = await prisma.scheduledEmail.create({
      data: {
        userId: user.id,
        senderAccountId: sender.id,
        to: "t@test.com",
        subject: "Stuck sending",
        body: "b",
        scheduledAt: new Date(),
        status: EmailStatus.SENDING,
        smtpMessageId: null,
      },
    });

    const jid = emailJobId(email.id);
    const jobs = new Map<string, { state: string; returnvalue?: unknown }>([
      [jid, { state: "completed", returnvalue: { messageId: "<healed@test>" } }],
    ]);
    const queue = mockQueue(jobs);

    const restored = await reconcilePendingEmails(queue, es);
    assert.ok(restored >= 1);

    const row = await prisma.scheduledEmail.findUniqueOrThrow({
      where: { id: email.id },
    });
    assert.equal(row.status, EmailStatus.SENT);
    assert.equal(row.smtpMessageId, "<healed@test>");

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
