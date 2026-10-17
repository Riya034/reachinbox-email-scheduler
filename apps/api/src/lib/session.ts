import crypto from "node:crypto";
import type { Response } from "express";
import type { Env } from "../config/env.js";

export const SESSION_COOKIE_NAME = "reachinbox_session";
const SESSION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

type SessionPayload = {
  userId: string;
  exp: number;
};

function signPayload(payloadB64: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(payloadB64).digest("base64url");
}

export function createSessionToken(userId: string, secret: string): string {
  const payload: SessionPayload = {
    userId,
    exp: Date.now() + SESSION_MAX_AGE_MS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = signPayload(payloadB64, secret);
  return `${payloadB64}.${signature}`;
}

export function verifySessionToken(
  token: string,
  secret: string,
): { userId: string } | null {
  const [payloadB64, signature] = token.split(".");
  if (!payloadB64 || !signature) {
    return null;
  }
  const expected = signPayload(payloadB64, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    return null;
  }
  try {
    const payload = JSON.parse(
      Buffer.from(payloadB64, "base64url").toString("utf8"),
    ) as SessionPayload;
    if (!payload.userId || typeof payload.exp !== "number") {
      return null;
    }
    if (Date.now() > payload.exp) {
      return null;
    }
    return { userId: payload.userId };
  } catch {
    return null;
  }
}

export function sessionCookieOptions(env: Env): {
  httpOnly: boolean;
  secure: boolean;
  sameSite: "lax";
  maxAge: number;
  path: string;
} {
  return {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_MS,
    path: "/",
  };
}

export function setSessionCookie(res: Response, userId: string, env: Env): void {
  const token = createSessionToken(userId, env.SESSION_SECRET);
  res.cookie(SESSION_COOKIE_NAME, token, sessionCookieOptions(env));
}

export function clearSessionCookie(res: Response, env: Env): void {
  res.clearCookie(SESSION_COOKIE_NAME, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: "lax",
    path: "/",
  });
}
