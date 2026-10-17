import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { EmailStatus, type ScheduledEmail } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { emailJobId, type EmailJobData } from "../queues/email.types.js";
import { indexScheduledEmailSafe } from "./email-index.service.js";

const RECONCILE_STATUSES: EmailStatus[] = [
  EmailStatus.SCHEDULED,
  EmailStatus.QUEUED,
  EmailStatus.SENDING,
];

const ENQUEUE_FAILURE_PREFIX = "Failed to enqueue send job:";

export function computeDelayMs(scheduledAt: Date): number {
  return Math.max(0, scheduledAt.getTime() - Date.now());
}

export async function enqueueEmailJob(
  queue: Queue<EmailJobData>,
  elasticsearch: Client,
  email: ScheduledEmail,
): Promise<ScheduledEmail> {
  const jobId = emailJobId(email.id);
  const delay = computeDelayMs(email.scheduledAt);

  const existing = await queue.getJob(jobId);
  if (existing) {
    const state = await existing.getState();
    if (state === "delayed" || state === "waiting") {
      await existing.changeDelay(delay);
    }
  } else {
    await queue.add(
      "send",
      { emailId: email.id },
      {
        jobId,
        delay,
      },
    );
  }

  let record = email;
  if (
    email.status === EmailStatus.SCHEDULED ||
    email.status === EmailStatus.SENDING
  ) {
    record = await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.QUEUED,
        bullJobId: jobId,
      },
    });
  } else if (!email.bullJobId) {
    record = await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: { bullJobId: jobId },
    });
  }

  await indexScheduledEmailSafe(elasticsearch, record);
  return record;
}

export async function scheduleEmail(params: {
  queue: Queue<EmailJobData>;
  elasticsearch: Client;
  userId: string;
  senderAccountId: string;
  campaignId?: string;
  to: string;
  subject: string;
  body: string;
  scheduledAt: Date;
  sequenceOrder?: number;
}): Promise<ScheduledEmail> {
  const sender = await prisma.senderAccount.findFirst({
    where: { id: params.senderAccountId, userId: params.userId, isActive: true },
  });
  if (!sender) {
    throw new Error("Sender account not found or inactive");
  }

  if (params.campaignId) {
    const campaign = await prisma.campaign.findFirst({
      where: { id: params.campaignId, userId: params.userId },
    });
    if (!campaign) {
      throw new Error("Campaign not found");
    }
  }

  const email = await prisma.scheduledEmail.create({
    data: {
      userId: params.userId,
      senderAccountId: params.senderAccountId,
      campaignId: params.campaignId,
      to: params.to,
      subject: params.subject,
      body: params.body,
      scheduledAt: params.scheduledAt,
      sequenceOrder: params.sequenceOrder ?? 0,
      status: EmailStatus.SCHEDULED,
    },
  });

  try {
    return await enqueueEmailJob(params.queue, params.elasticsearch, email);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: {
        status: EmailStatus.FAILED,
        errorMessage: `Failed to enqueue send job: ${message}`,
      },
    });
    throw err;
  }
}

export async function cancelScheduledEmail(
  queue: Queue<EmailJobData>,
  elasticsearch: Client,
  emailId: string,
): Promise<ScheduledEmail | null> {
  const email = await prisma.scheduledEmail.findUnique({ where: { id: emailId } });
  if (!email) {
    return null;
  }
  if (
    email.status === EmailStatus.SENT ||
    email.status === EmailStatus.CANCELLED ||
    email.status === EmailStatus.FAILED
  ) {
    return email;
  }

  const job = await queue.getJob(emailJobId(emailId));
  if (job) {
    await job.remove();
  }

  const updated = await prisma.scheduledEmail.update({
    where: { id: emailId },
    data: { status: EmailStatus.CANCELLED, bullJobId: null },
  });
  await indexScheduledEmailSafe(elasticsearch, updated);
  return updated;
}

async function healSendingWithoutSmtpProof(
  queue: Queue<EmailJobData>,
  elasticsearch: Client,
  email: ScheduledEmail,
): Promise<boolean> {
  if (email.status !== EmailStatus.SENDING || email.smtpMessageId) {
    return false;
  }

  const job = await queue.getJob(emailJobId(email.id));
  const state = job ? await job.getState() : null;

  if (job && state === "completed") {
    const rv = job.returnvalue as { messageId?: string } | undefined;
    if (rv?.messageId) {
      await prisma.scheduledEmail.update({
        where: { id: email.id },
        data: {
          status: EmailStatus.SENT,
          sentAt: new Date(),
          smtpMessageId: rv.messageId,
          errorMessage: null,
          bullJobId: null,
        },
      });
      const healed = await prisma.scheduledEmail.findUniqueOrThrow({
        where: { id: email.id },
      });
      await indexScheduledEmailSafe(elasticsearch, healed);
      return true;
    }
  }

  if (job && (state === "active" || state === "waiting" || state === "delayed")) {
    return false;
  }

  await prisma.scheduledEmail.updateMany({
    where: {
      id: email.id,
      status: EmailStatus.SENDING,
      smtpMessageId: null,
    },
    data: { status: EmailStatus.QUEUED },
  });
  const refreshed = await prisma.scheduledEmail.findUniqueOrThrow({
    where: { id: email.id },
  });
  await enqueueEmailJob(queue, elasticsearch, refreshed);
  return true;
}

export async function reconcilePendingEmails(
  queue: Queue<EmailJobData>,
  elasticsearch: Client,
): Promise<number> {
  const pending = await prisma.scheduledEmail.findMany({
    where: {
      OR: [
        { status: { in: RECONCILE_STATUSES } },
        {
          status: EmailStatus.FAILED,
          smtpMessageId: null,
          errorMessage: { startsWith: ENQUEUE_FAILURE_PREFIX },
        },
      ],
    },
    orderBy: [{ scheduledAt: "asc" }, { sequenceOrder: "asc" }],
  });

  let restored = 0;
  for (const email of pending) {
    if (email.status === EmailStatus.FAILED) {
      const reset = await prisma.scheduledEmail.updateMany({
        where: {
          id: email.id,
          status: EmailStatus.FAILED,
          smtpMessageId: null,
          errorMessage: { startsWith: ENQUEUE_FAILURE_PREFIX },
        },
        data: {
          status: EmailStatus.SCHEDULED,
          errorMessage: null,
        },
      });
      if (reset.count === 0) {
        continue;
      }
      const refreshed = await prisma.scheduledEmail.findUniqueOrThrow({
        where: { id: email.id },
      });
      await enqueueEmailJob(queue, elasticsearch, refreshed);
      restored += 1;
      continue;
    }

    if (await healSendingWithoutSmtpProof(queue, elasticsearch, email)) {
      restored += 1;
      continue;
    }

    const job = await queue.getJob(emailJobId(email.id));
    if (!job) {
      await enqueueEmailJob(queue, elasticsearch, email);
      restored += 1;
      continue;
    }

    const state = await job.getState();
    if (state === "failed") {
      await job.retry();
      restored += 1;
    }
  }

  if (restored > 0) {
    console.log(`[scheduler] Reconciled ${restored} email job(s) into BullMQ`);
  }
  return restored;
}

export async function campaignHasEarlierPending(
  campaignId: string,
  sequenceOrder: number,
): Promise<boolean> {
  const count = await prisma.scheduledEmail.count({
    where: {
      campaignId,
      sequenceOrder: { lt: sequenceOrder },
      status: {
        in: [
          EmailStatus.SCHEDULED,
          EmailStatus.QUEUED,
          EmailStatus.SENDING,
        ],
      },
    },
  });
  return count > 0;
}
