import type { Env } from "../config/env.js";
import { ensureDefaultSenderForUser } from "./bootstrap.js";
import { prisma } from "./prisma.js";

export async function resolveDefaultSenderAccountId(
  userId: string,
  env: Env,
): Promise<string> {
  const existing = await prisma.senderAccount.findFirst({
    where: { userId, label: "default-ethereal" },
    select: { id: true },
  });
  if (existing) {
    return existing.id;
  }
  return ensureDefaultSenderForUser(userId, env);
}
