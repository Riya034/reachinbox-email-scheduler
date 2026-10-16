import { Client } from "@elastic/elasticsearch";
import type { Env } from "../config/env.js";

export function createElasticsearchClient(env: Env): Client {
  return new Client({
    node: env.ELASTICSEARCH_URL,
  });
}

export const EMAILS_INDEX = "scheduled_emails";

export async function ensureEmailsIndex(client: Client): Promise<void> {
  const exists = await client.indices.exists({ index: EMAILS_INDEX });
  if (exists) {
    return;
  }
  await client.indices.create({
    index: EMAILS_INDEX,
    mappings: {
      properties: {
        id: { type: "keyword" },
        userId: { type: "keyword" },
        to: { type: "keyword" },
        subject: { type: "text" },
        body: { type: "text" },
        status: { type: "keyword" },
        scheduledAt: { type: "date" },
        sentAt: { type: "date" },
        createdAt: { type: "date" },
      },
    },
  });
}
