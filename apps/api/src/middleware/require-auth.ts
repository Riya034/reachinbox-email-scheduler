import type { NextFunction, Request, Response } from "express";
import type { Env } from "../config/env.js";
import { SESSION_COOKIE_NAME, verifySessionToken } from "../lib/session.js";

export function createRequireAuthMiddleware(
  env: Env,
  integrationTestUserId: string,
): (req: Request, res: Response, next: NextFunction) => void {
  return (req, res, next) => {
    if (
      env.NODE_ENV !== "production" &&
      env.INTEGRATION_TEST_AUTH_SECRET
    ) {
      const testHeader = req.get("X-Integration-Test-Auth");
      if (testHeader === env.INTEGRATION_TEST_AUTH_SECRET) {
        req.userId = integrationTestUserId;
        next();
        return;
      }
    }

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

    req.userId = session.userId;
    next();
  };
}
