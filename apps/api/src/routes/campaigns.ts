import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const createSchema = z.object({
  name: z.string().min(1).max(200),
  senderAccountId: z.string().min(1),
});

export function campaignsRouter(devUserId: string): Router {
  const router = Router();

  router.post("/", async (req, res) => {
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
      return;
    }

    const sender = await prisma.senderAccount.findFirst({
      where: { id: parsed.data.senderAccountId, userId: devUserId, isActive: true },
    });
    if (!sender) {
      res.status(400).json({ error: "Sender account not found" });
      return;
    }

    const campaign = await prisma.campaign.create({
      data: {
        userId: devUserId,
        senderAccountId: parsed.data.senderAccountId,
        name: parsed.data.name,
      },
    });

    res.status(201).json(campaign);
  });

  router.get("/", async (_req, res) => {
    const campaigns = await prisma.campaign.findMany({
      where: { userId: devUserId },
      include: {
        senderAccount: {
          select: { id: true, label: true, fromEmail: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    res.json({ data: campaigns });
  });

  router.get("/:id", async (req, res) => {
    const campaign = await prisma.campaign.findFirst({
      where: { id: req.params.id, userId: devUserId },
      include: {
        senderAccount: {
          select: { id: true, label: true, fromEmail: true },
        },
      },
    });
    if (!campaign) {
      res.status(404).json({ error: "Campaign not found" });
      return;
    }
    res.json(campaign);
  });

  return router;
}
