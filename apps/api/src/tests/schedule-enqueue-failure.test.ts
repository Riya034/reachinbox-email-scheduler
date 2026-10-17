import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EmailStatus } from "@prisma/client";
import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { prisma } from "../lib/prisma.js";
import { scheduleEmail } from "../services/email-scheduler.service.js";
import type { EmailJobData } from "../queues/email.types.js";

describe("scheduleEmail queue enqueue failure", () => {
  it("marks email FAILED when BullMQ enqueue throws", async () => {
    const user = await prisma.user.create({
      data: { email: `enqueue-fail-${Date.now()}@example.com`, name: "Test" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "test-sender",
        fromEmail: "from@test.com",
        smtpUser: "u",
        smtpPass: "p",
      },
    });

    const failingQueue = {
      getJob: async () => null,
      add: async () => {
        throw new Error("redis unavailable");
      },
    } as unknown as Queue<EmailJobData>;

    const es = {} as Client;

    await assert.rejects(
      () =>
        scheduleEmail({
          queue: failingQueue,
          elasticsearch: es,
          userId: user.id,
          senderAccountId: sender.id,
          to: "to@test.com",
          subject: "Subj",
          body: "Body",
          scheduledAt: new Date(Date.now() + 60_000),
        }),
      /redis unavailable/,
    );

    const row = await prisma.scheduledEmail.findFirst({
      where: { userId: user.id, subject: "Subj" },
    });
    assert.ok(row);
    assert.equal(row!.status, EmailStatus.FAILED);
    assert.match(row!.errorMessage ?? "", /Failed to enqueue send job/);

    await prisma.scheduledEmail.deleteMany({ where: { userId: user.id } });
    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});
