import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  decryptSmtpPassFromStorage,
  encryptSmtpPassForStorage,
  isEncryptedSmtpPass,
} from "../lib/sender-credential-crypto.js";
import { loadEnv } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import {
  migratePlaintextSenderCredentials,
  prepareSmtpPassForStorage,
  resolveSenderForTransport,
} from "../services/sender-credential.service.js";

const KEY = "test-encryption-key-at-least-32-characters-long";

describe("smtp credential crypto", () => {
  it("encrypts and decrypts without exposing prefix confusion", () => {
    const stored = encryptSmtpPassForStorage("secret-pass", KEY);
    assert.ok(isEncryptedSmtpPass(stored));
    assert.equal(decryptSmtpPassFromStorage(stored, KEY), "secret-pass");
  });

  it("passes through legacy plaintext in non-production paths", () => {
    assert.equal(decryptSmtpPassFromStorage("plain", KEY), "plain");
  });

  it("rejects invalid encryption key length", () => {
    assert.throws(() => encryptSmtpPassForStorage("x", "short"));
  });

  it("fails decryption with wrong key", () => {
    const stored = encryptSmtpPassForStorage("secret-pass", KEY);
    assert.throws(() => decryptSmtpPassFromStorage(stored, KEY + "-wrong"));
  });
});

async function postgresReachable(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("migratePlaintextSenderCredentials", () => {
  it("is idempotent and preserves decryptability", async (t) => {
    if (!(await postgresReachable())) {
      t.skip("Postgres not available");
      return;
    }
    const env = loadEnv();
    const user = await prisma.user.create({
      data: { email: `smtp-mig-${Date.now()}@example.com`, name: "Mig" },
    });
    const sender = await prisma.senderAccount.create({
      data: {
        userId: user.id,
        label: "mig-sender",
        fromEmail: "from@test.com",
        smtpUser: "u",
        smtpPass: "plaintext-password",
      },
    });

    const first = await migratePlaintextSenderCredentials(env, {
      onlySenderIds: [sender.id],
    });
    assert.equal(first.migrated, 1);

    const row = await prisma.senderAccount.findUniqueOrThrow({
      where: { id: sender.id },
    });
    assert.ok(isEncryptedSmtpPass(row.smtpPass));

    const second = await migratePlaintextSenderCredentials(env, {
      onlySenderIds: [sender.id],
    });
    assert.equal(second.migrated, 0);
    assert.equal(second.skipped, 1);

    const transport = resolveSenderForTransport(row, env);
    assert.equal(transport.smtpPass, "plaintext-password");

    await prisma.senderAccount.delete({ where: { id: sender.id } });
    await prisma.user.delete({ where: { id: user.id } });
  });
});

describe("prepareSmtpPassForStorage", () => {
  it("uses TOKEN_ENCRYPTION_KEY from env", () => {
    const env = loadEnv();
    const stored = prepareSmtpPassForStorage("pw", env);
    assert.ok(isEncryptedSmtpPass(stored));
  });
});
