import { Router } from "express";
import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { EmailStatus } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import type { EmailJobData } from "../queues/email.types.js";
import {
  cancelScheduledEmail,
  scheduleEmail,
} from "../services/email-scheduler.service.js";

const scheduleBodySchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1),
  scheduledAt: z.string().min(1),
  senderAccountId: z.string().min(1).optional(),
  campaignId: z.string().min(1).optional(),
  sequenceOrder: z.coerce.number().int().nonnegative().optional(),
});

export function emailsRouter(
  queue: Queue<EmailJobData>,
  elasticsearch: Client,
  devUserId: string,
  defaultSenderAccountId: string,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = scheduleBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const scheduledAt = new Date(parsed.data.scheduledAt);
    if (Number.isNaN(scheduledAt.getTime())) {
      res.status(400).json({ error: "Invalid scheduledAt" });
      return;
    }

    try {
      const email = await scheduleEmail({
        queue,
        elasticsearch,
        userId: devUserId,
        senderAccountId: parsed.data.senderAccountId ?? defaultSenderAccountId,
        campaignId: parsed.data.campaignId,
        to: parsed.data.to,
        subject: parsed.data.subject,
        body: parsed.data.body,
        scheduledAt,
        sequenceOrder: parsed.data.sequenceOrder,
      });
      res.status(201).json(email);
    } catch (err) {
      console.error(err);
      res.status(500).json({
        error: "Failed to schedule email",
        detail: err instanceof Error ? err.message : String(err),
      });
    }
  });

  router.get("/", async (req, res) => {
    const statusParam = req.query.status;
    const list = z.enum(["scheduled", "sent", "all"]).optional().safeParse(statusParam);

    let statusFilter: EmailStatus[] | undefined;
    if (list.success && list.data === "scheduled") {
      statusFilter = [
        EmailStatus.SCHEDULED,
        EmailStatus.QUEUED,
        EmailStatus.SENDING,
      ];
    } else if (list.success && list.data === "sent") {
      statusFilter = [EmailStatus.SENT, EmailStatus.FAILED];
    }

    const emails = await prisma.scheduledEmail.findMany({
      where: {
        userId: devUserId,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      include: {
        senderAccount: { select: { id: true, label: true, fromEmail: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduledAt: "desc" }, { sequenceOrder: "asc" }],
    });

    res.json({ data: emails });
  });

  router.get("/:id", async (req, res) => {
    const email = await prisma.scheduledEmail.findFirst({
      where: { id: req.params.id, userId: devUserId },
      include: {
        senderAccount: { select: { id: true, label: true, fromEmail: true } },
        campaign: { select: { id: true, name: true } },
      },
    });
    if (!email) {
      res.status(404).json({ error: "Email not found" });
      return;
    }
    res.json(email);
  });

  router.delete("/:id", async (req, res) => {
    const email = await prisma.scheduledEmail.findFirst({
      where: { id: req.params.id, userId: devUserId },
    });
    if (!email) {
      res.status(404).json({ error: "Email not found" });
      return;
    }

    const updated = await cancelScheduledEmail(queue, elasticsearch, email.id);
    res.json(updated);
  });

  return router;
}
