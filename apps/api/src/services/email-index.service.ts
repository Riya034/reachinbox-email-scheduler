import type { Client } from "@elastic/elasticsearch";
import type { ScheduledEmail } from "@prisma/client";
import { EMAILS_INDEX } from "../lib/elasticsearch.js";

export async function indexScheduledEmail(
  client: Client,
  email: ScheduledEmail,
): Promise<void> {
  await client.index({
    index: EMAILS_INDEX,
    id: email.id,
    document: {
      id: email.id,
      userId: email.userId,
      campaignId: email.campaignId,
      senderAccountId: email.senderAccountId,
      to: email.to,
      subject: email.subject,
      body: email.body,
      status: email.status,
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: email.sentAt?.toISOString() ?? null,
      smtpMessageId: email.smtpMessageId,
      sequenceOrder: email.sequenceOrder,
      createdAt: email.createdAt.toISOString(),
    },
    refresh: false,
  });
}
