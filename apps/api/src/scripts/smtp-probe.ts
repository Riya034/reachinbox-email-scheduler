import nodemailer from "nodemailer";
import { loadEnv } from "../config/env.js";

async function main(): Promise<void> {
  const env = loadEnv();
  console.log(`Probing ${env.SMTP_HOST}:${env.SMTP_PORT}...`);

  const account = await nodemailer.createTestAccount();
  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: { user: account.user, pass: account.pass },
    connectionTimeout: 20_000,
  });

  await transporter.verify();
  const info = await transporter.sendMail({
    from: account.user,
    to: "probe@example.com",
    subject: "ReachInbox SMTP probe",
    text: "probe",
  });
  const preview = nodemailer.getTestMessageUrl(info);
  console.log("SMTP probe OK");
  console.log("messageId:", info.messageId);
  if (typeof preview === "string") {
    console.log("preview:", preview);
  }
}

main().catch((err) => {
  console.error("SMTP probe FAILED:", err instanceof Error ? err.message : err);
  process.exit(1);
});
