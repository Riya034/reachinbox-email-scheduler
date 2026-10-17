import { DelayedError, Worker, type Job } from "bullmq";
import type { Redis } from "ioredis";
import type { Client } from "@elastic/elasticsearch";
import { EmailStatus } from "@prisma/client";
import type { Env } from "../config/env.js";
import { sendViaSenderAccount } from "../lib/mailer.js";
import { prisma } from "../lib/prisma.js";
import { tryAcquireSenderSendSlot } from "../lib/sender-rate-limit.js";
import { scheduleSlackRateLimitNotification } from "../services/slack-rate-limit-notify.service.js";
import { EMAIL_QUEUE_NAME } from "../queues/email.queue.js";
import type { EmailJobData } from "../queues/email.types.js";
import { campaignHasEarlierPending } from "../services/email-scheduler.service.js";
import { indexScheduledEmailSafe } from "../services/email-index.service.js";
async function postponeJob(
  job: Job<EmailJobData>,
  token: string,
  emailId: string,
  retryAfterMs: number,
  elasticsearch: Client,
): Promise<never> {
  await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: {
      status: EmailStatus.QUEUED,
      lastPostponedAt: new Date(),
    },
  });
  const updated = await prisma.scheduledEmail.findUniqueOrThrow({ where: { id: emailId } });
  await indexScheduledEmailSafe(elasticsearch, updated);

  await job.moveToDelayed(Date.now() + retryAfterMs, token);
  throw new DelayedError(`postponed ${retryAfterMs}ms`);
}

export function startEmailWorker(
  connection: Redis,
  rateLimitRedis: Redis,
  elasticsearch: Client,
  env: Env,
): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(
    EMAIL_QUEUE_NAME,
    async (job, token) => {
      if (!token) {
        throw new Error("Missing BullMQ job lock token");
      }
      const { emailId } = job.data;
      const email = await prisma.scheduledEmail.findUnique({
        where: { id: emailId },
        include: { senderAccount: true },
      });

      if (!email) {
        return { skipped: true, reason: "not_found" };
      }

      if (email.status === EmailStatus.SENT) {
        return { skipped: true, reason: "already_sent" };
      }
      if (email.status === EmailStatus.CANCELLED) {
        return { skipped: true, reason: "cancelled" };
      }

      if (email.campaignId) {
        const blocked = await campaignHasEarlierPending(
          email.campaignId,
          email.sequenceOrder,
        );
        if (blocked) {
          await postponeJob(job, token, emailId, 2_000, elasticsearch);
        }
      }

      const claim = await prisma.scheduledEmail.updateMany({
        where: {
          id: emailId,
          status: { in: [EmailStatus.SCHEDULED, EmailStatus.QUEUED] },
        },
        data: {
          status: EmailStatus.SENDING,
        },
      });

      if (claim.count === 0) {
        const current = await prisma.scheduledEmail.findUnique({ where: { id: emailId } });
        if (current?.status === EmailStatus.SENT) {
          return { skipped: true, reason: "already_sent" };
        }
        if (current?.status === EmailStatus.SENDING) {
          return { skipped: true, reason: "in_progress" };
        }
        throw new Error(`Email ${emailId} not claimable (${current?.status})`);
      }

      const slot = await tryAcquireSenderSendSlot(
        rateLimitRedis,
        email.senderAccountId,
        email.senderAccount.hourlyLimit,
        email.senderAccount.minDelayMs,
      );

      if (!slot.acquired) {
        scheduleSlackRateLimitNotification({
          env,
          redis: rateLimitRedis,
          userId: email.userId,
          emailId,
          senderLabel: email.senderAccount.label,
          fromEmail: email.senderAccount.fromEmail,
          to: email.to,
          subject: email.subject,
          reason: slot.reason,
          retryAfterMs: slot.retryAfterMs,
        });
        await prisma.scheduledEmail.update({
          where: { id: emailId },
          data: { status: EmailStatus.QUEUED },
        });
        await postponeJob(job, token, emailId, slot.retryAfterMs, elasticsearch);
      }

      const fresh = await prisma.scheduledEmail.findUniqueOrThrow({
        where: { id: emailId },
        include: { senderAccount: true },
      });

      await prisma.scheduledEmail.update({
        where: { id: emailId },
        data: { attemptCount: { increment: 1 } },
      });

      try {
        const result = await sendViaSenderAccount(fresh.senderAccount, env, {
          to: fresh.to,
          subject: fresh.subject,
          body: fresh.body,
        });

        const sent = await prisma.scheduledEmail.update({
          where: { id: emailId },
          data: {
            status: EmailStatus.SENT,
            sentAt: new Date(),
            smtpMessageId: result.messageId,
            errorMessage: null,
            bullJobId: null,
          },
        });
        await indexScheduledEmailSafe(elasticsearch, sent);

        if (result.previewUrl) {
          console.log(`[worker] ${emailId} sent — preview: ${result.previewUrl}`);
        }

        return { messageId: result.messageId, previewUrl: result.previewUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const maxAttempts = job.opts.attempts ?? 1;
        const isFinalAttempt = job.attemptsMade + 1 >= maxAttempts;

        const updated = await prisma.scheduledEmail.update({
          where: { id: emailId },
          data: {
            status: isFinalAttempt ? EmailStatus.FAILED : EmailStatus.QUEUED,
            errorMessage: message,
          },
        });
        await indexScheduledEmailSafe(elasticsearch, updated);
        throw err;
      }
    },
    {
      connection,
      concurrency: env.EMAIL_QUEUE_CONCURRENCY,
    },
  );

  worker.on("failed", (job, err) => {
    console.error(`[worker] Job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[worker] Job ${job.id} completed`);
  });

  return worker;
}
