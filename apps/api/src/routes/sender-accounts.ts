import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { createEtherealSenderCredentials, verifySenderAccount } from "../lib/mailer.js";
import type { Env } from "../config/env.js";
import { prepareSmtpPassForStorage } from "../services/sender-credential.service.js";

const createEtherealSchema = z.object({
  label: z.string().min(1).max(120),
  hourlyLimit: z.coerce.number().int().positive().optional(),
  minDelayMs: z.coerce.number().int().nonnegative().optional(),
});

const createCustomSmtpSchema = z.object({
  label: z.string().min(1).max(120),
  fromEmail: z.string().email(),
  smtpHost: z.string().min(1).max(253),
  smtpPort: z.coerce.number().int().min(1).max(65535),
  smtpUser: z.string().min(1).max(320),
  smtpPass: z.string().min(1).max(512),
  hourlyLimit: z.coerce.number().int().positive().optional(),
  minDelayMs: z.coerce.number().int().nonnegative().optional(),
});

export function senderAccountsRouter(env: Env): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const userId = req.userId!;
    const parsed = createEtherealSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const creds = await createEtherealSenderCredentials();
      const sender = await prisma.senderAccount.create({
        data: {
          userId,
          label: parsed.data.label,
          fromEmail: creds.fromEmail,
          smtpHost: env.SMTP_HOST,
          smtpPort: env.SMTP_PORT,
          smtpUser: creds.smtpUser,
          smtpPass: prepareSmtpPassForStorage(creds.smtpPass, env),
          hourlyLimit: parsed.data.hourlyLimit ?? env.SENDER_DEFAULT_HOURLY_LIMIT,
          minDelayMs: parsed.data.minDelayMs ?? env.SENDER_DEFAULT_MIN_DELAY_MS,
        },
      });

      try {
        await verifySenderAccount(sender, env);
      } catch (verifyErr) {
        console.warn(
          "[sender-accounts] SMTP verify failed (sender still created):",
          verifyErr instanceof Error ? verifyErr.message : verifyErr,
        );
      }

      res.status(201).json({
        id: sender.id,
        label: sender.label,
        fromEmail: sender.fromEmail,
        smtpHost: sender.smtpHost,
        smtpPort: sender.smtpPort,
        smtpUser: sender.smtpUser,
        hourlyLimit: sender.hourlyLimit,
        minDelayMs: sender.minDelayMs,
        isActive: sender.isActive,
        createdAt: sender.createdAt,
        updatedAt: sender.updatedAt,
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

  router.post("/smtp", async (req, res) => {
    const userId = req.userId!;
    const parsed = createCustomSmtpSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    try {
      const sender = await prisma.senderAccount.create({
        data: {
          userId,
          label: parsed.data.label,
          fromEmail: parsed.data.fromEmail,
          smtpHost: parsed.data.smtpHost,
          smtpPort: parsed.data.smtpPort,
          smtpUser: parsed.data.smtpUser,
          smtpPass: prepareSmtpPassForStorage(parsed.data.smtpPass, env),
          hourlyLimit: parsed.data.hourlyLimit ?? env.SENDER_DEFAULT_HOURLY_LIMIT,
          minDelayMs: parsed.data.minDelayMs ?? env.SENDER_DEFAULT_MIN_DELAY_MS,
        },
      });

      try {
        await verifySenderAccount(sender, env);
      } catch (verifyErr) {
        await prisma.senderAccount.delete({ where: { id: sender.id } });
        res.status(400).json({
          error: "SMTP verification failed",
          detail: verifyErr instanceof Error ? verifyErr.message : String(verifyErr),
        });
        return;
      }

      res.status(201).json({
        id: sender.id,
        label: sender.label,
        fromEmail: sender.fromEmail,
        smtpHost: sender.smtpHost,
        smtpPort: sender.smtpPort,
        smtpUser: sender.smtpUser,
        hourlyLimit: sender.hourlyLimit,
        minDelayMs: sender.minDelayMs,
        isActive: sender.isActive,
        createdAt: sender.createdAt,
        updatedAt: sender.updatedAt,
      });
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Failed to create SMTP sender",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/", async (req, res) => {
    const senders = await prisma.senderAccount.findMany({
      where: { userId: req.userId! },
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
      where: { id: req.params.id, userId: req.userId! },
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
