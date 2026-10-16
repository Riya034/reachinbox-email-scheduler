import { loadEnv } from "../config/env.js";
import { createRuntime, closeRuntime } from "../lib/runtime.js";
import { emailJobId } from "../queues/email.types.js";
import { scheduleEmail, reconcilePendingEmails } from "../services/email-scheduler.service.js";
import { prisma } from "../lib/prisma.js";

async function main(): Promise<void> {
  const env = loadEnv();
  const ctx = await createRuntime(env);

  const scheduledAt = new Date(Date.now() + 120_000);
  const email = await scheduleEmail({
    queue: ctx.emailQueue,
    elasticsearch: ctx.elasticsearch,
    userId: ctx.devUserId,
    senderAccountId: ctx.defaultSenderAccountId,
    to: "recovery@example.com",
    subject: "Recovery test",
    body: "Job should survive reconcile",
    scheduledAt,
  });

  const jobId = emailJobId(email.id);
  let job = await ctx.emailQueue.getJob(jobId);
  if (!job) {
    throw new Error("Expected BullMQ job after schedule");
  }
  console.log("[PASS] Job enqueued with deterministic id:", jobId);

  await job.remove();
  job = await ctx.emailQueue.getJob(jobId);
  if (job) {
    throw new Error("Job should be removed");
  }
  console.log("[PASS] Simulated Redis job loss");

  const restored = await reconcilePendingEmails(ctx.emailQueue, ctx.elasticsearch);
  if (restored < 1) {
    throw new Error(`Expected reconcile to restore job, got ${restored}`);
  }
  job = await ctx.emailQueue.getJob(jobId);
  if (!job) {
    throw new Error("Job not restored after reconcile");
  }
  console.log("[PASS] reconcilePendingEmails restored delayed job");

  await prisma.scheduledEmail.delete({ where: { id: email.id } });
  await job.remove();

  await closeRuntime(ctx);
  console.log("\nQueue recovery test: ALL PASSED");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
