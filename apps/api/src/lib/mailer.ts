import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SenderAccount } from "@prisma/client";
import type { Env } from "../config/env.js";
import { resolveSenderForTransport } from "../services/sender-credential.service.js";

const transporterCache = new Map<string, Transporter>();

function cacheKey(account: SenderAccount): string {
  return `${account.id}:${account.smtpPass.length}`;
}

export async function createEtherealSenderCredentials(): Promise<{
  smtpUser: string;
  smtpPass: string;
  fromEmail: string;
}> {
  const testAccount = await nodemailer.createTestAccount();
  return {
    smtpUser: testAccount.user,
    smtpPass: testAccount.pass,
    fromEmail: testAccount.user,
  };
}

function getTransporter(account: SenderAccount): Transporter {
  const key = cacheKey(account);
  const cached = transporterCache.get(key);
  if (cached) {
    return cached;
  }

  const transporter = nodemailer.createTransport({
    host: account.smtpHost,
    port: account.smtpPort,
    secure: account.smtpPort === 465,
    auth: {
      user: account.smtpUser,
      pass: account.smtpPass,
    },
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
  });

  transporterCache.set(key, transporter);
  return transporter;
}

export async function sendViaSenderAccount(
  account: SenderAccount,
  env: Env,
  params: { to: string; subject: string; body: string },
): Promise<{ messageId: string; previewUrl?: string }> {
  const transportAccount = resolveSenderForTransport(account, env);
  const transporter = getTransporter(transportAccount);
  const info = await transporter.sendMail({
    from: transportAccount.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.body,
    html: `<p>${params.body.replace(/\n/g, "<br>")}</p>`,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  const previewUrl = typeof preview === "string" ? preview : undefined;
  return { messageId: info.messageId, previewUrl };
}

export async function verifySenderAccount(
  account: SenderAccount,
  env: Env,
): Promise<void> {
  const transportAccount = resolveSenderForTransport(account, env);
  const transporter = getTransporter(transportAccount);
  await transporter.verify();
}
