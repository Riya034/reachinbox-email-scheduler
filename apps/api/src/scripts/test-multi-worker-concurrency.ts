/**
 * Two BullMQ workers competing on a disposable sender — rate limits + no duplicate SENT rows.
 *
 * Does not reset global Redis keys except the isolated test sender.
 * SMTP is real (Ethereal); at-least-once semantics still apply if a provider retries externally.
 */
import { EmailStatus } from "@prisma/client";
import { loadEnv } from "../config/env.js";
import { createElasticsearchClient } from "../lib/elasticsearch.js";
import { createBullMqConnection } from "../lib/redis.js";
import { resetSenderRateLimits } from "../lib/sender-rate-limit.js";
import { prisma } from "../lib/prisma.js";
import { prepareSmtpPassForStorage } from "../services/sender-credential.service.js";
import { createEtherealSenderCredentials } from "../lib/mailer.js";
import { scheduleEmail } from "../services/email-scheduler.service.js";
import { createEmailQueue } from "../queues/email.queue.js";
import { emailJobId } from "../queues/email.types.js";
import { startEmailWorker } from "../workers/email.worker.js";

const RUN_ID = Date.now();
const EMAIL_COUNT = 5;
const TIMEOUT_MS = 120_000;
const POLL_MS = 500;

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

async function main(): Promise<void> {
  const env = loadEnv();
  const queueConn = createBullMqConnection(env);
  await queueConn.connect();
  const rateRedis = createBullMqConnection(env);
  await rateRedis.connect();
  const elasticsearch = createElasticsearchClient(env);
  const queue = createEmailQueue(queueConn);

  const user = await prisma.user.create({
    data: {
      email: `multi-worker-${RUN_ID}@concurrency.test`,
      name: "Multi-worker test",
    },
  });

  const creds = await createEtherealSenderCredentials();
  const sender = await prisma.senderAccount.create({
    data: {
      userId: user.id,
      label: `multi-worker-isolated-${RUN_ID}`,
      fromEmail: creds.fromEmail,
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT,
      smtpUser: creds.smtpUser,
      smtpPass: prepareSmtpPassForStorage(creds.smtpPass, env),
      hourlyLimit: 20,
      minDelayMs: 400,
    },
  });

  await resetSenderRateLimits(rateRedis, sender.id);

  const emailIds: string[] = [];
  for (let i = 0; i < EMAIL_COUNT; i++) {
    const email = await scheduleEmail({
      queue,
      elasticsearch,
      userId: user.id,
      senderAccountId: sender.id,
      to: `mw-${RUN_ID}-${i}@example.com`,
      subject: `Multi-worker ${RUN_ID} #${i}`,
      body: "concurrency probe",
      scheduledAt: new Date(Date.now() + 500 + i * 50),
    });
    emailIds.push(email.id);
  }

  const workerConn1 = createBullMqConnection(env);
  const workerConn2 = createBullMqConnection(env);
  await workerConn1.connect();
  await workerConn2.connect();

  const w1 = startEmailWorker(workerConn1, rateRedis, elasticsearch, env);
  const w2 = startEmailWorker(workerConn2, rateRedis, elasticsearch, env);

  const started = Date.now();
  let postponedSeen = false;

  while (Date.now() - started < TIMEOUT_MS) {
    const rows = await prisma.scheduledEmail.findMany({
      where: { id: { in: emailIds } },
    });
    if (rows.some((r) => r.lastPostponedAt)) {
      postponedSeen = true;
    }
    const sent = rows.filter((r) => r.status === EmailStatus.SENT);
    if (sent.length === EMAIL_COUNT) {
      const messageIds = sent
        .map((r) => r.smtpMessageId)
        .filter((id): id is string => Boolean(id));
      assertUnique(messageIds, "smtpMessageId");
      assertUnique(sent.map((r) => r.id), "email id");

      await w1.close(true);
      await w2.close(true);
      await cleanup(emailIds, sender.id, user.id, queue, queueConn, rateRedis, workerConn1, workerConn2);

      console.log(
        JSON.stringify({
          pass: true,
          emails: EMAIL_COUNT,
          postponedSeen,
          note: "Rate limits enforced via Redis; duplicate SENT rows not observed under concurrent workers.",
        }),
      );
      return;
    }
    await sleep(POLL_MS);
  }

  await w1.close(true);
  await w2.close(true);
  await cleanup(emailIds, sender.id, user.id, queue, queueConn, rateRedis, workerConn1, workerConn2);
  throw new Error("Timeout waiting for all emails to reach SENT");
}

function assertUnique(values: string[], label: string): void {
  const set = new Set(values);
  if (set.size !== values.length) {
    throw new Error(`Duplicate ${label} detected`);
  }
}

async function cleanup(
  emailIds: string[],
  senderId: string,
  userId: string,
  queue: ReturnType<typeof createEmailQueue>,
  queueConn: Awaited<ReturnType<typeof createBullMqConnection>>,
  rateRedis: Awaited<ReturnType<typeof createBullMqConnection>>,
  w1: Awaited<ReturnType<typeof createBullMqConnection>>,
  w2: Awaited<ReturnType<typeof createBullMqConnection>>,
): Promise<void> {
  for (const id of emailIds) {
    const job = await queue.getJob(emailJobId(id));
    if (job) {
      await job.remove();
    }
  }
  await prisma.scheduledEmail.deleteMany({ where: { id: { in: emailIds } } });
  await prisma.senderAccount.delete({ where: { id: senderId } });
  await prisma.user.delete({ where: { id: userId } });
  await queue.close();
  await queueConn.quit();
  await rateRedis.quit();
  await w1.quit();
  await w2.quit();
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
