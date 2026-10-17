import crypto from "node:crypto";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";
const OAUTH_STATE_TTL_SEC = 600;
const OAUTH_STATE_PREFIX = "oauth:google:state:";

const SCOPES = ["openid", "email", "profile"].join(" ");

export function isGoogleOAuthConfigured(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);
}

export async function createGoogleOAuthState(redis: Redis): Promise<string> {
  const state = crypto.randomBytes(32).toString("base64url");
  await redis.set(`${OAUTH_STATE_PREFIX}${state}`, "1", "EX", OAUTH_STATE_TTL_SEC);
  return state;
}

export async function consumeGoogleOAuthState(
  redis: Redis,
  state: string,
): Promise<boolean> {
  if (!state || state.length > 128) {
    return false;
  }
  const key = `${OAUTH_STATE_PREFIX}${state}`;
  const deleted = await redis.del(key);
  return deleted === 1;
}

export function buildGoogleAuthUrl(env: Env, state: string): string {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.GOOGLE_CALLBACK_URL,
    response_type: "code",
    scope: SCOPES,
    state,
    access_type: "online",
    prompt: "select_account",
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export type GoogleUserInfo = {
  id: string;
  email: string;
  verified_email: boolean;
  name?: string;
  picture?: string;
};

export async function exchangeGoogleCode(
  env: Env,
  code: string,
): Promise<GoogleUserInfo> {
  const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.GOOGLE_CALLBACK_URL,
      grant_type: "authorization_code",
    }),
  });

  const tokenJson = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
    error_description?: string;
  };

  if (!tokenRes.ok || !tokenJson.access_token) {
    throw new Error(
      tokenJson.error_description ?? tokenJson.error ?? "Google token exchange failed",
    );
  }

  const userRes = await fetch(GOOGLE_USERINFO_URL, {
    headers: { Authorization: `Bearer ${tokenJson.access_token}` },
  });

  const user = (await userRes.json()) as GoogleUserInfo & { error?: { message: string } };
  if (!userRes.ok || !user.id || !user.email) {
    throw new Error(user.error?.message ?? "Failed to load Google profile");
  }
  if (!user.verified_email) {
    throw new Error("Google account email is not verified");
  }

  return user;
}
