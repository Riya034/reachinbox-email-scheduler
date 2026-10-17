import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailStatus } from "@prisma/client";
import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { prisma } from "../lib/prisma.js";
import { emailJobId, type EmailJobData } from "../queues/email.types.js";
import {
  reconcilePendingEmails,
  scheduleEmail,
} from "../services/email-scheduler.service.js";

const es = {} as Client;

async function postgresReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("restart recovery (queue + idempotency)", () => {
  it("restores missing Bull job after simulated worker/API restart", async (t) => {
    if (!(await postgresReachable())) {
      t.skip("Postgres not available");
      return;
    }

    const user = await prisma.user.create({
      data: { email: `restart-${Date.now()}@test.local`, name: "Restart" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "restart-sender",
        fromEmail: "from@test.com",
        smtpUser: "u",
        smtpPass: "p",
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
          remove: async () => {
            jobs.delete(id);
          },
          changeDelay: async () => {},
        };
      },
      add: async (_name: string, data: { emailId: string }) => {
        jobs.set(emailJobId(data.emailId), { state: "delayed" });
        return {};
      },
    } as unknown as Queue<EmailJobData>;

    const email = await scheduleEmail({
      queue,
      elasticsearch: es,
      userId: user.id,
      senderAccountId: sender.id,
      to: "restart@test.com",
      subject: "Restart probe",
      body: "body",
      scheduledAt: new Date(Date.now() + 120_000),
    });

    const jid = emailJobId(email.id);
    assert.ok(jobs.has(jid));

    jobs.delete(jid);
    const restored = await reconcilePendingEmails(queue, es);
    assert.ok(restored >= 1);
    assert.ok(jobs.has(jid));

    const sent = await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.SENT,
        sentAt: new Date(),
        smtpMessageId: "<already@test>",
      },
    });

    jobs.delete(jid);
    const restoredAgain = await reconcilePendingEmails(queue, es);
    assert.equal(restoredAgain, 0);
    assert.equal(sent.status, EmailStatus.SENT);

    await prisma.scheduledEmail.delete({ where: { id: email.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
