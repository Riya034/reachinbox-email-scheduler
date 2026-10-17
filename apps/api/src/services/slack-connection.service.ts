import type { SlackConnection } from "@prisma/client";
import type { Env } from "../config/env.js";
import { decryptSecret, encryptSecret } from "../lib/token-crypto.js";
import { prisma } from "../lib/prisma.js";

export type SlackConnectionPublic = {
  connected: boolean;
  teamName: string | null;
  slackUserId: string | null;
  scopes: string | null;
  revoked: boolean;
  error: string | null;
};

export function toPublicSlackStatus(
  row: SlackConnection | null,
): SlackConnectionPublic {
  if (!row || row.revokedAt) {
    return {
      connected: false,
      teamName: row?.teamName ?? null,
      slackUserId: row?.slackUserId ?? null,
      scopes: row?.scopes ?? null,
      revoked: Boolean(row?.revokedAt),
      error: row?.revokedAt ? "Slack access was revoked. Reconnect to resume notifications." : null,
    };
  }
  return {
    connected: true,
    teamName: row.teamName,
    slackUserId: row.slackUserId,
    scopes: row.scopes,
    revoked: false,
    error: null,
  };
}

export async function getSlackConnectionForUser(
  userId: string,
): Promise<SlackConnection | null> {
  return prisma.slackConnection.findUnique({ where: { userId } });
}

export async function upsertSlackConnection(params: {
  userId: string;
  slackUserId: string;
  slackTeamId: string;
  teamName: string;
  accessToken: string;
  scopes: string;
  env: Env;
}): Promise<SlackConnection> {
  const encryptedAccessToken = encryptSecret(
    params.accessToken,
    params.env.TOKEN_ENCRYPTION_KEY,
  );
  return prisma.slackConnection.upsert({
    where: { userId: params.userId },
    create: {
      userId: params.userId,
      slackUserId: params.slackUserId,
      slackTeamId: params.slackTeamId,
      teamName: params.teamName,
      encryptedAccessToken,
      scopes: params.scopes,
      revokedAt: null,
    },
    update: {
      slackUserId: params.slackUserId,
      slackTeamId: params.slackTeamId,
      teamName: params.teamName,
      encryptedAccessToken,
      scopes: params.scopes,
      revokedAt: null,
    },
  });
}

export async function disconnectSlackForUser(userId: string): Promise<void> {
  await prisma.slackConnection.deleteMany({ where: { userId } });
}

export async function markSlackConnectionRevoked(userId: string): Promise<void> {
  await prisma.slackConnection.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export function decryptSlackAccessToken(
  connection: SlackConnection,
  env: Env,
): string {
  return decryptSecret(connection.encryptedAccessToken, env.TOKEN_ENCRYPTION_KEY);
}
