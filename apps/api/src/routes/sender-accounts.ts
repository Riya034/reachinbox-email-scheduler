import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { createEtherealSenderCredentials, verifySenderAccount } from "../lib/mailer.js";
import type { Env } from "../config/env.js";

const createSchema = z.object({
  label: z.string().min(1).max(120),
  hourlyLimit: z.coerce.number().int().positive().optional(),
  minDelayMs: z.coerce.number().int().nonnegative().optional(),
});

export function senderAccountsRouter(devUserId: string, env: Env): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const creds = await createEtherealSenderCredentials();
      const sender = await prisma.senderAccount.create({
        data: {
          userId: devUserId,
          label: parsed.data.label,
          fromEmail: creds.fromEmail,
          smtpHost: env.SMTP_HOST,
          smtpPort: env.SMTP_PORT,
          smtpUser: creds.smtpUser,
          smtpPass: creds.smtpPass,
          hourlyLimit: parsed.data.hourlyLimit ?? env.SENDER_DEFAULT_HOURLY_LIMIT,
          minDelayMs: parsed.data.minDelayMs ?? env.SENDER_DEFAULT_MIN_DELAY_MS,
        },
      });

      try {
        await verifySenderAccount(sender);
      } catch (verifyErr) {
        console.warn(
          "[sender-accounts] SMTP verify failed (sender still created):",
          verifyErr instanceof Error ? verifyErr.message : verifyErr,
        );
      }

      res.status(201).json({
        ...sender,
        smtpPass: undefined,
        smtpUser: sender.smtpUser,
        etherealLoginHint: "Use smtpUser + stored credentials; preview at https://ethereal.email/login",
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Failed to create Ethereal sender",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/", async (_req, res) => {
    const senders = await prisma.senderAccount.findMany({
      where: { userId: devUserId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        label: true,
        fromEmail: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        hourlyLimit: true,
        minDelayMs: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    res.json({ data: senders });
  });

  router.get("/:id", async (req, res) => {
    const sender = await prisma.senderAccount.findFirst({
      where: { id: req.params.id, userId: devUserId },
      select: {
        id: true,
        label: true,
        fromEmail: true,
        smtpHost: true,
        smtpPort: true,
        smtpUser: true,
        hourlyLimit: true,
        minDelayMs: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });
    if (!sender) {
      res.status(404).json({ error: "Sender not found" });
      return;
    }
    res.json(sender);
  });

  return router;
}
