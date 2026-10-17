import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import {
  decryptSlackAccessToken,
  markSlackConnectionRevoked,
} from "./slack-connection.service.js";
import { getSlackApiClient } from "./slack-api.js";

export type RateLimitPostponeReason = "hourly_limit" | "min_delay";

const DEDUPE_PREFIX = "slack:ratelimit:dedupe:";

function dedupeKey(emailId: string, reason: RateLimitPostponeReason): string {
  return `${DEDUPE_PREFIX}${emailId}:${reason}`;
}

function formatNextEligible(retryAfterMs: number): string {
  const at = new Date(Date.now() + retryAfterMs);
  return at.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

function reasonLabel(reason: RateLimitPostponeReason): string {
  return reason === "hourly_limit"
    ? "Hourly send limit reached (Redis)"
    : "Minimum delay between sends (Redis)";
}

export async function tryNotifySlackRateLimitPostponement(params: {
  env: Env;
  redis: Redis;
  userId: string;
  emailId: string;
  senderLabel: string;
  fromEmail: string;
  to: string;
  subject: string;
  reason: RateLimitPostponeReason;
  retryAfterMs: number;
}): Promise<void> {
  const key = dedupeKey(params.emailId, params.reason);
  const ttlSec = Math.max(60, Math.ceil(params.retryAfterMs / 1000));
  const acquired = await params.redis.set(key, "1", "EX", ttlSec, "NX");
  if (acquired !== "OK") {
    return;
  }

  const connection = await prisma.slackConnection.findUnique({
    where: { userId: params.userId },
  });
  if (!connection || connection.revokedAt) {
    return;
  }

  let accessToken: string;
  try {
    accessToken = decryptSlackAccessToken(connection, params.env);
  } catch {
    console.warn("[slack] Failed to decrypt token for user", params.userId);
    return;
  }

  const client = getSlackApiClient(accessToken);
  const text = [
    ":warning: *ReachInbox — send postponed (rate limit)*",
    `• *Sender:* ${params.senderLabel} (${params.fromEmail})`,
    `• *Reason:* ${reasonLabel(params.reason)}`,
    `• *Next eligible:* ~${formatNextEligible(params.retryAfterMs)}`,
    `• *Email:* to ${params.to} — "${params.subject}"`,
    `• *Job ID:* ${params.emailId}`,
  ].join("\n");

  const dm = await client.openDm(connection.slackUserId);
  if (!dm.ok) {
    if (dm.revoked) {
      await markSlackConnectionRevoked(params.userId);
    }
    console.warn("[slack] openDm failed:", dm.error);
    return;
  }

  const posted = await client.postMessage(dm.data, text);
  if (!posted.ok) {
    if (posted.revoked) {
      await markSlackConnectionRevoked(params.userId);
    }
    console.warn("[slack] postMessage failed:", posted.error);
  }
}

/** Fire-and-forget wrapper — never throws to caller */
export function scheduleSlackRateLimitNotification(
  params: Omit<
    Parameters<typeof tryNotifySlackRateLimitPostponement>[0],
    "env" | "redis"
  > & { env: Env; redis: Redis },
): void {
  void tryNotifySlackRateLimitPostponement(params).catch((err) => {
    console.warn(
      "[slack] rate-limit notification error:",
      err instanceof Error ? err.message : String(err),
    );
  });
}
