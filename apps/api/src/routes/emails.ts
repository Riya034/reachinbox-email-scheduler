import { Router } from "express";
import type { Queue } from "bullmq";
import type { Client } from "@elastic/elasticsearch";
import { EmailStatus } from "@prisma/client";
import { z } from "zod";
import type { Env } from "../config/env.js";
import { resolveDefaultSenderAccountId } from "../lib/default-sender.js";
import { prisma } from "../lib/prisma.js";
import type { EmailJobData } from "../queues/email.types.js";
import {
  cancelScheduledEmail,
  scheduleEmail,
} from "../services/email-scheduler.service.js";
import {
  ElasticsearchSearchUnavailableError,
  searchEmails,
} from "../services/email-search.service.js";

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
  env: Env,
): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const userId = req.userId!;
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
      const defaultSenderId = await resolveDefaultSenderAccountId(userId, env);
      const email = await scheduleEmail({
        queue,
        elasticsearch,
        userId,
        senderAccountId: parsed.data.senderAccountId ?? defaultSenderId,
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

  router.get("/search", async (req, res) => {
    const userId = req.userId!;
    const q = typeof req.query.q === "string" ? req.query.q : "";
    const variant = z.enum(["scheduled", "sent"]).safeParse(req.query.status);
    if (!variant.success) {
      res.status(400).json({ error: "Invalid status (scheduled|sent)" });
      return;
    }
    if (!q.trim()) {
      res.status(400).json({ error: "Query parameter q is required for search" });
      return;
    }

    try {
      const result = await searchEmails(elasticsearch, {
        userId,
        q,
        variant: variant.data,
        limit: 50,
      });
      res.json({
        data: result.data,
        meta: result.meta,
      });
    } catch (err) {
      if (err instanceof ElasticsearchSearchUnavailableError) {
        res.status(503).json({
          error: err.message,
          hint: "Search is temporarily unavailable. List view still reflects PostgreSQL.",
        });
        return;
      }
      console.error(err);
      res.status(500).json({ error: "Search failed" });
    }
  });

  const listQuerySchema = z.object({
    status: z.enum(["scheduled", "sent", "all"]).optional(),
    limit: z.coerce.number().int().min(1).max(500).optional(),
  });

  router.get("/", async (req, res) => {
    const parsedQuery = listQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      res.status(400).json({ error: "Invalid query", details: parsedQuery.error.flatten() });
      return;
    }
    const statusParam = parsedQuery.data.status;
    const limit = parsedQuery.data.limit ?? 200;
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
        userId: req.userId!,
        ...(statusFilter ? { status: { in: statusFilter } } : {}),
      },
      include: {
        senderAccount: { select: { id: true, label: true, fromEmail: true } },
        campaign: { select: { id: true, name: true } },
      },
      orderBy: [{ scheduledAt: "desc" }, { sequenceOrder: "asc" }],
      take: limit,
    });

    res.json({
      data: emails,
      meta: { limit, truncated: emails.length === limit },
    });
  });

  router.get("/:id", async (req, res) => {
    const email = await prisma.scheduledEmail.findFirst({
      where: { id: req.params.id, userId: req.userId! },
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
      where: { id: req.params.id, userId: req.userId! },
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
