import type { Client } from "@elastic/elasticsearch";
import type { ScheduledEmail } from "@prisma/client";
import { EMAILS_INDEX } from "../lib/elasticsearch.js";
import { prisma } from "../lib/prisma.js";

export type EmailIndexDocument = {
  emailId: string;
  id: string;
  userId: string;
  campaignId: string | null;
  campaignName: string | null;
  senderAccountId: string;
  senderLabel: string;
  fromEmail: string;
  to: string;
  subject: string;
  body: string;
  status: string;
  scheduledAt: string;
  sentAt: string | null;
  lastPostponedAt: string | null;
  createdAt: string;
  updatedAt: string;
  smtpMessageId: string | null;
  sequenceOrder: number;
};

export function buildEmailIndexDocument(
  email: ScheduledEmail & {
    senderAccount?: { label: string; fromEmail: string } | null;
    campaign?: { name: string } | null;
  },
): EmailIndexDocument {
  return {
    emailId: email.id,
    id: email.id,
    userId: email.userId,
    campaignId: email.campaignId,
    campaignName: email.campaign?.name ?? null,
    senderAccountId: email.senderAccountId,
    senderLabel: email.senderAccount?.label ?? "",
    fromEmail: email.senderAccount?.fromEmail ?? "",
    to: email.to,
    subject: email.subject,
    body: email.body,
    status: email.status,
    scheduledAt: email.scheduledAt.toISOString(),
    sentAt: email.sentAt?.toISOString() ?? null,
    lastPostponedAt: email.lastPostponedAt?.toISOString() ?? null,
    createdAt: email.createdAt.toISOString(),
    updatedAt: email.updatedAt.toISOString(),
    smtpMessageId: email.smtpMessageId,
    sequenceOrder: email.sequenceOrder,
  };
}

async function loadEmailForIndex(emailId: string) {
  return prisma.scheduledEmail.findUnique({
    where: { id: emailId },
    include: {
      senderAccount: { select: { label: true, fromEmail: true } },
      campaign: { select: { name: true } },
    },
  });
}

export async function indexScheduledEmail(
  client: Client,
  email: ScheduledEmail,
): Promise<void> {
  const full = await loadEmailForIndex(email.id);
  if (!full) {
    return;
  }

  await client.index({
    index: EMAILS_INDEX,
    id: email.id,
    document: buildEmailIndexDocument(full),
    refresh: false,
  });
}

/** Best-effort indexing — never throws to callers (Postgres remains source of truth). */
export async function indexScheduledEmailSafe(
  client: Client,
  email: ScheduledEmail,
): Promise<boolean> {
  try {
    await indexScheduledEmail(client, email);
    return true;
  } catch (err) {
    console.warn(
      "[es] index failed",
      email.id,
      err instanceof Error ? err.message : String(err),
    );
    return false;
  }
}
