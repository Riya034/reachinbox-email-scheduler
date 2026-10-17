import crypto from "node:crypto";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";

const SLACK_AUTH_URL = "https://slack.com/oauth/v2/authorize";
const SLACK_TOKEN_URL = "https://slack.com/api/oauth.v2.access";
const OAUTH_STATE_PREFIX = "oauth:slack:state:";
const OAUTH_STATE_TTL_SEC = 600;

export const SLACK_BOT_SCOPES = [
  "chat:write",
  "im:write",
  "users:read",
  "team:read",
].join(",");

export function isSlackOAuthConfigured(env: Env): boolean {
  return Boolean(env.SLACK_CLIENT_ID && env.SLACK_CLIENT_SECRET);
}

export async function createSlackOAuthState(
  redis: Redis,
  userId: string,
): Promise<string> {
  const state = crypto.randomBytes(32).toString("base64url");
  await redis.set(
    `${OAUTH_STATE_PREFIX}${state}`,
    userId,
    "EX",
    OAUTH_STATE_TTL_SEC,
  );
  return state;
}

export async function consumeSlackOAuthState(
  redis: Redis,
  state: string,
): Promise<string | null> {
  if (!state || state.length > 128) {
    return null;
  }
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const userId = await redis.get(key);
  if (!userId) {
    return null;
  }
  await redis.del(key);
  return userId;
}

export function buildSlackAuthUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.SLACK_CLIENT_ID,
    scope: SLACK_BOT_SCOPES,
    redirect_uri: env.SLACK_CALLBACK_URL,
    state,
  });
  return `${SLACK_AUTH_URL}?${params.toString()}`;
}

export type SlackOAuthResponse = {
  ok: boolean;
  access_token?: string;
  scope?: string;
  team?: { id: string; name: string };
  authed_user?: { id: string };
  error?: string;
};

export async function exchangeSlackCode(
  env: Env,
  code: string,
): Promise<SlackOAuthResponse> {
  const res = await fetch(SLACK_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.SLACK_CLIENT_ID,
      client_secret: env.SLACK_CLIENT_SECRET,
      code,
      redirect_uri: env.SLACK_CALLBACK_URL,
    }),
  });
  return (await res.json()) as SlackOAuthResponse;
}
