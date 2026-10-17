import type { SenderAccount } from "@prisma/client";
import type { Env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import {
  decryptSmtpPassFromStorage,
  encryptSmtpPassForStorage,
  isEncryptedSmtpPass,
} from "../lib/sender-credential-crypto.js";

export function prepareSmtpPassForStorage(plaintext: string, env: Env): string {
  return encryptSmtpPassForStorage(plaintext, env.TOKEN_ENCRYPTION_KEY);
}

/** In-memory transport view; never persist or log the returned password. */
export function resolveSenderForTransport(
  account: SenderAccount,
  env: Env,
): SenderAccount {
  return {
    ...account,
    smtpPass: decryptSmtpPassFromStorage(account.smtpPass, env.TOKEN_ENCRYPTION_KEY),
  };
}

export type MigrateSenderCredentialsResult = {
  migrated: number;
  skipped: number;
  failed: { id: string; reason: string }[];
};

/**
 * Idempotent: encrypts plaintext `smtpPass` values in place.
 * Validates round-trip before each update. Does not touch already-encrypted rows.
 */
export async function migratePlaintextSenderCredentials(
  env: Env,
  options: { dryRun?: boolean; onlySenderIds?: string[] } = {},
): Promise<MigrateSenderCredentialsResult> {
  const dryRun = options.dryRun ?? false;
  const senders = await prisma.senderAccount.findMany({
    where: options.onlySenderIds?.length
      ? { id: { in: options.onlySenderIds } }
      : undefined,
    select: { id: true, smtpPass: true },
  });

  let migrated = 0;
  let skipped = 0;
  const failed: { id: string; reason: string }[] = [];

  for (const sender of senders) {
    if (isEncryptedSmtpPass(sender.smtpPass)) {
      skipped += 1;
      continue;
    }

    try {
      const encrypted = encryptSmtpPassForStorage(
        sender.smtpPass,
        env.TOKEN_ENCRYPTION_KEY,
      );
      const roundTrip = decryptSmtpPassFromStorage(encrypted, env.TOKEN_ENCRYPTION_KEY);
      if (roundTrip !== sender.smtpPass) {
        failed.push({ id: sender.id, reason: "round_trip_mismatch" });
        continue;
      }
      if (!dryRun) {
        await prisma.senderAccount.update({
          where: { id: sender.id },
          data: { smtpPass: encrypted },
        });
      }
      migrated += 1;
    } catch (err) {
      failed.push({
        id: sender.id,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return { migrated, skipped, failed };
}

export async function assertProductionSenderCredentialsEncrypted(
  env: Env,
): Promise<void> {
  if (env.NODE_ENV !== "production") {
    return;
  }

  const plaintext = await prisma.senderAccount.findMany({
    where: { smtpPass: { not: { startsWith: "enc1:" } } },
    select: { id: true },
    take: 5,
  });

  if (plaintext.length > 0) {
    throw new Error(
      `Plaintext SMTP credentials detected (${plaintext.length}+ row(s)). ` +
        "Back up Postgres, run `npm run migrate:sender-credentials -w @reachinbox/api`, then restart.",
    );
  }
}
