/**
 * Backfill scheduled_emails index from PostgreSQL (idempotent re-index).
 *
 * Usage: npm run backfill:elasticsearch -w @reachinbox/api
 */
import { loadEnv } from "../config/env.js";
import { createElasticsearchClient, ensureEmailsIndex } from "../lib/elasticsearch.js";
import { prisma } from "../lib/prisma.js";
import { indexScheduledEmailSafe } from "../services/email-index.service.js";

const BATCH = 100;

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createElasticsearchClient(env);
  await ensureEmailsIndex(client);

  const total = await prisma.scheduledEmail.count();
  console.log(`[backfill] ${total} email(s) in PostgreSQL`);

  let processed = 0;
  let indexed = 0;
  let skip = 0;

  while (true) {
    const batch = await prisma.scheduledEmail.findMany({
      take: BATCH,
      skip,
      orderBy: { id: "asc" },
      include: {
        senderAccount: { select: { label: true, fromEmail: true } },
        campaign: { select: { name: true } },
      },
    });
    if (batch.length === 0) {
      break;
    }

    for (const email of batch) {
      const ok = await indexScheduledEmailSafe(client, email);
      if (ok) {
        indexed += 1;
      }
    }
    processed += batch.length;
    skip += batch.length;
    console.log(`[backfill] ${processed}/${total} processed, ${indexed} indexed`);
  }

  console.log(`[backfill] Done. indexed=${indexed} failed=${processed - indexed}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
