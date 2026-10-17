import { Client } from "@elastic/elasticsearch";
import type { Env } from "../config/env.js";

export function createElasticsearchClient(env: Env): Client {
  return new Client({
    node: env.ELASTICSEARCH_URL,
  });
}

export const EMAILS_INDEX = "scheduled_emails";

const INDEX_MAPPINGS = {
  properties: {
    emailId: { type: "keyword" },
    id: { type: "keyword" },
    userId: { type: "keyword" },
    campaignId: { type: "keyword" },
    campaignName: { type: "text", fields: { keyword: { type: "keyword" } } },
    senderAccountId: { type: "keyword" },
    senderLabel: { type: "text", fields: { keyword: { type: "keyword" } } },
    fromEmail: { type: "text", fields: { keyword: { type: "keyword" } } },
    to: { type: "text", fields: { keyword: { type: "keyword" } } },
    subject: { type: "text" },
    body: { type: "text" },
    status: { type: "keyword" },
    scheduledAt: { type: "date" },
    sentAt: { type: "date" },
    lastPostponedAt: { type: "date" },
    createdAt: { type: "date" },
    updatedAt: { type: "date" },
    smtpMessageId: { type: "keyword" },
    sequenceOrder: { type: "integer" },
  },
} as const;

export async function ensureEmailsIndex(client: Client): Promise<void> {
  const exists = await client.indices.exists({ index: EMAILS_INDEX });
  if (!exists) {
    await client.indices.create({
      index: EMAILS_INDEX,
      mappings: INDEX_MAPPINGS,
    });
    return;
  }

  try {
    await client.indices.putMapping({
      index: EMAILS_INDEX,
      ...INDEX_MAPPINGS,
    });
  } catch {
    // Existing deployments may reject mapping updates; indexing still works with dynamic fields.
  }
}
