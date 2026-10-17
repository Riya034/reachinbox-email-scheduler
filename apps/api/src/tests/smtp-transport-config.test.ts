import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { SenderAccount } from "@prisma/client";
import { loadEnv } from "../config/env.js";
import {
  prepareSmtpPassForStorage,
  resolveSenderForTransport,
} from "../services/sender-credential.service.js";
import { isEncryptedSmtpPass } from "../lib/sender-credential-crypto.js";

describe("SMTP transport configuration", () => {
  it("builds a decryptable sender account for Nodemailer", () => {
    const env = loadEnv();
    const stored = prepareSmtpPassForStorage("smtp-secret", env);
    const account: SenderAccount = {
      id: "sender-1",
      userId: "user-1",
      label: "test",
      fromEmail: "from@test.com",
      smtpHost: "smtp.ethereal.email",
      smtpPort: 587,
      smtpUser: "user@test.com",
      smtpPass: stored,
      hourlyLimit: 10,
      minDelayMs: 0,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    assert.ok(isEncryptedSmtpPass(account.smtpPass));
    const transport = resolveSenderForTransport(account, env);
    assert.equal(transport.smtpPass, "smtp-secret");
    assert.equal(transport.smtpHost, "smtp.ethereal.email");
    assert.equal(transport.smtpPort, 587);
  });
});
