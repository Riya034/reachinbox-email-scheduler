import { Router } from "express";
import type { Redis } from "ioredis";
import type { Env } from "../config/env.js";
import {
  buildSlackAuthUrl,
  consumeSlackOAuthState,
  createSlackOAuthState,
  exchangeSlackCode,
  isSlackOAuthConfigured,
} from "../lib/slack-oauth.js";
import { prisma } from "../lib/prisma.js";
import {
  disconnectSlackForUser,
  getSlackConnectionForUser,
  toPublicSlackStatus,
  upsertSlackConnection,
} from "../services/slack-connection.service.js";

export function slackRouter(env: Env, redis: Redis): Router {
  const router = Router();

  router.get("/status", async (req, res) => {
    const userId = req.userId!;
    const row = await getSlackConnectionForUser(userId);
    res.json(toPublicSlackStatus(row));
  });

  router.get("/connect", async (req, res) => {
    const userId = req.userId!;
    if (!isSlackOAuthConfigured(env)) {
      res.status(503).json({
        error: "Slack OAuth is not configured",
        hint: "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env",
      });
      return;
    }
    try {
      const state = await createSlackOAuthState(redis, userId);
      res.redirect(buildSlackAuthUrl(env, state));
    } catch (err) {
      console.error("[slack] connect redirect failed:", err);
      res.status(500).json({ error: "Failed to start Slack authorization" });
    }
  });

  router.get("/reconnect", async (req, res) => {
    const userId = req.userId!;
    if (!isSlackOAuthConfigured(env)) {
      res.status(503).json({
        error: "Slack OAuth is not configured",
        hint: "Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in .env",
      });
      return;
    }
    try {
      const state = await createSlackOAuthState(redis, userId);
      res.redirect(buildSlackAuthUrl(env, state));
    } catch (err) {
      console.error("[slack] reconnect redirect failed:", err);
      res.status(500).json({ error: "Failed to start Slack reauthorization" });
    }
  });

  router.post("/disconnect", async (req, res) => {
    const userId = req.userId!;
    await disconnectSlackForUser(userId);
    await prisma.user.updateMany({
      where: { id: userId },
      data: { slackId: null },
    });
    res.json({ ok: true, ...toPublicSlackStatus(null) });
  });

  return router;
}

export function slackCallbackRouter(env: Env, redis: Redis): Router {
  const router = Router();

  router.get("/callback", async (req, res) => {
    const settingsUrl = new URL("/scheduled", env.WEB_URL);
    settingsUrl.searchParams.set("slack", "1");

    const fail = (code: string) => {
      settingsUrl.searchParams.set("slack_error", code);
      res.redirect(settingsUrl.toString());
    };

    if (!isSlackOAuthConfigured(env)) {
      fail("oauth_not_configured");
      return;
    }

    const error = typeof req.query.error === "string" ? req.query.error : null;
    if (error) {
      fail(error);
      return;
    }

    const code = typeof req.query.code === "string" ? req.query.code : null;
    const state = typeof req.query.state === "string" ? req.query.state : null;
    if (!code || !state) {
      fail("invalid_callback");
      return;
    }

    const userId = await consumeSlackOAuthState(redis, state);
    if (!userId) {
      fail("invalid_state");
      return;
    }

    try {
      const token = await exchangeSlackCode(env, code);
      if (!token.ok || !token.access_token || !token.team?.id || !token.authed_user?.id) {
        fail(token.error ?? "oauth_failed");
        return;
      }

      const slackUserId = token.authed_user.id;

      const linkedElsewhere = await prisma.user.findFirst({
        where: { slackId: slackUserId, id: { not: userId } },
        select: { id: true },
      });
      if (linkedElsewhere) {
        fail("slack_already_linked");
        return;
      }

      try {
        await upsertSlackConnection({
          userId,
          slackUserId,
          slackTeamId: token.team.id,
          teamName: token.team.name ?? "Slack workspace",
          accessToken: token.access_token,
          scopes: token.scope ?? "",
          env,
        });

        await prisma.user.update({
          where: { id: userId },
          data: { slackId: slackUserId },
        });
      } catch (linkErr) {
        await disconnectSlackForUser(userId);
        throw linkErr;
      }

      settingsUrl.searchParams.set("slack_connected", "1");
      res.redirect(settingsUrl.toString());
    } catch (err) {
      console.error("[slack] callback failed:", err);
      fail("oauth_failed");
    }
  });

  return router;
}
