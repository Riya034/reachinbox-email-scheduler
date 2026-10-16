import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SenderAccount } from "@prisma/client";

const transporterCache = new Map<string, Transporter>();

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
  const cached = transporterCache.get(account.id);
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

  transporterCache.set(account.id, transporter);
  return transporter;
}

export async function sendViaSenderAccount(
  account: SenderAccount,
  params: { to: string; subject: string; body: string },
): Promise<{ messageId: string; previewUrl?: string }> {
  const transporter = getTransporter(account);
  const info = await transporter.sendMail({
    from: account.fromEmail,
    to: params.to,
    subject: params.subject,
    text: params.body,
    html: `<p>${params.body.replace(/\n/g, "<br>")}</p>`,
  });

  const preview = nodemailer.getTestMessageUrl(info);
  const previewUrl = typeof preview === "string" ? preview : undefined;
  return { messageId: info.messageId, previewUrl };
}

export async function verifySenderAccount(account: SenderAccount): Promise<void> {
  const transporter = getTransporter(account);
  await transporter.verify();
}
