import type { Env } from "../config/env.js";
import { prisma } from "./prisma.js";
import { createEtherealSenderCredentials } from "./mailer.js";
import { prepareSmtpPassForStorage } from "../services/sender-credential.service.js";

export async function ensureDevSchedulerUser(email: string): Promise<string> {
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name: "Scheduler (dev)" },
    update: {},
  });
  return user.id;
}

export async function ensureDefaultSenderForUser(
  userId: string,
  env: Env,
): Promise<string> {
  const existing = await prisma.senderAccount.findFirst({
    where: { userId, label: "default-ethereal" },
  });
  if (existing) {
    return existing.id;
  }

  let smtpUser = env.ETHEREAL_USER;
  let smtpPass = env.ETHEREAL_PASS;
  let fromEmail = env.SMTP_FROM ?? smtpUser;

  if (!smtpUser || !smtpPass) {
    const creds = await createEtherealSenderCredentials();
    smtpUser = creds.smtpUser;
    smtpPass = creds.smtpPass;
    fromEmail = creds.fromEmail;
    if (env.NODE_ENV === "development") {
      console.log("[bootstrap] Created default Ethereal sender:");
      console.log(`  ETHEREAL_USER=${smtpUser}`);
      console.log(`  ETHEREAL_PASS=${smtpPass}`);
    } else {
      console.log(
        "[bootstrap] Created default Ethereal sender (credentials stored in Postgres only)",
      );
    }
  }

  const sender = await prisma.senderAccount.create({
    data: {
      userId,
      label: "default-ethereal",
      fromEmail: fromEmail ?? smtpUser,
      smtpHost: env.SMTP_HOST,
      smtpPort: env.SMTP_PORT,
      smtpUser,
      smtpPass: prepareSmtpPassForStorage(smtpPass, env),
      hourlyLimit: env.SENDER_DEFAULT_HOURLY_LIMIT,
      minDelayMs: env.SENDER_DEFAULT_MIN_DELAY_MS,
    },
  });

  return sender.id;
}
