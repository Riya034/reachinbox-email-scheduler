import { Router } from "express";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import { ensureDefaultSenderForUser } from "../lib/bootstrap.js";
import {
  buildGoogleAuthUrl,
  consumeGoogleOAuthState,
  createGoogleOAuthState,
  exchangeGoogleCode,
  isGoogleOAuthConfigured,
} from "../lib/google-oauth.js";
import { prisma } from "../lib/prisma.js";
import {
  clearSessionCookie,
  SESSION_COOKIE_NAME,
  setSessionCookie,
  verifySessionToken,
} from "../lib/session.js";

export function authRouter(env: Env, redis: Redis): Router {
  const router = Router();

  router.get("/google", async (_req, res) => {
    if (!isGoogleOAuthConfigured(env)) {
      res.status(503).json({
        error: "Google OAuth is not configured",
        hint: "Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env",
      });
      return;
    }

    try {
      const state = await createGoogleOAuthState(redis);
      const url = buildGoogleAuthUrl(env, state);
      res.redirect(url);
    } catch (err) {
      console.error("[auth] Google redirect failed:", err);
      res.status(500).json({ error: "Failed to start Google sign-in" });
    }
  });

  router.get("/google/callback", async (req, res) => {
    const loginError = (code: string) => {
      const target = new URL("/login", env.WEB_URL);
      target.searchParams.set("error", code);
      res.redirect(target.toString());
    };

    if (!isGoogleOAuthConfigured(env)) {
      loginError("oauth_not_configured");
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error) {
      loginError(error);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      loginError("invalid_callback");
      return;
    }

    const stateOk = await consumeGoogleOAuthState(redis, state);
    if (!stateOk) {
      loginError("invalid_state");
      return;
    }

    try {
      const googleUser = await exchangeGoogleCode(env, code);
      const user = await prisma.user.upsert({
        where: { email: googleUser.email },
        create: {
          googleId: googleUser.id,
          email: googleUser.email,
          name: googleUser.name ?? googleUser.email.split("@")[0],
          imageUrl: googleUser.picture ?? null,
        },
        update: {
          googleId: googleUser.id,
          name: googleUser.name ?? undefined,
          imageUrl: googleUser.picture ?? undefined,
        },
      });

      await ensureDefaultSenderForUser(user.id, env);
      setSessionCookie(res, user.id, env);

      const target = new URL("/scheduled", env.WEB_URL);
      res.redirect(target.toString());
    } catch (err) {
      console.error("[auth] Google callback failed:", err);
      loginError("oauth_failed");
    }
  });

  router.get("/me", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE_NAME] as string | undefined;
    if (!token) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    const session = verifySessionToken(token, env.SESSION_SECRET);
    if (!session) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }

    void prisma.user
      .findUnique({
        where: { id: session.userId },
        select: {
          id: true,
          email: true,
          name: true,
          imageUrl: true,
        },
      })
      .then((user) => {
        if (!user) {
          res.status(401).json({ error: "Unauthorized" });
          return;
        }
        res.json({
          id: user.id,
          email: user.email,
          name: user.name ?? user.email,
          imageUrl: user.imageUrl,
        });
      })
      .catch((err) => {
        console.error("[auth] /me failed:", err);
        res.status(500).json({ error: "Failed to load session" });
      });
  });

  router.post("/logout", (_req, res) => {
    clearSessionCookie(res, env);
    res.json({ ok: true });
  });

  return router;
}
