/**
 * Integration tests against a running API + worker (real Ethereal SMTP).
 *
 * Usage (two terminals):
 *   npm run dev:api -w @reachinbox/api
 *   npm run dev:worker -w @reachinbox/api
 *   npm run test:integration -w @reachinbox/api
 *
 * Test senders use tight limits only on dedicated accounts — production defaults are unchanged.
 */
import { loadEnv } from "../config/env.js";
import { createRedisConnection } from "../lib/redis.js";
import { resetSenderRateLimits } from "../lib/sender-rate-limit.js";

const env = loadEnv();
const API = env.API_URL;
const RUN_ID = Date.now();

/** Max time to wait for all emails in a delivery phase */
const DELIVERY_PHASE_TIMEOUT_MS = 90_000;
/** Poll interval when waiting on worker / rate limiter */
const POLL_MS = 1_000;

type Json = Record<string, unknown>;

async function api<T = Json>(
  path: string,
  init?: RequestInit,
): Promise<{ status: number; body: T }> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, body };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logResult(name: string, ok: boolean, detail?: string): void {
  console.log(`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

async function createTestSender(
  label: string,
  limits: { hourlyLimit: number; minDelayMs: number },
): Promise<string> {
  const res = await api<Json>("/sender-accounts", {
    method: "POST",
    body: JSON.stringify({
      label: `${label}-${RUN_ID}`,
      hourlyLimit: limits.hourlyLimit,
      minDelayMs: limits.minDelayMs,
    }),
  });
  if (res.status !== 201) {
    throw new Error(`create sender failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return String(res.body.id);
}

async function clearSenderRateLimitState(senderId: string): Promise<void> {
  const redis = createRedisConnection(env);
  await redis.connect();
  await resetSenderRateLimits(redis, senderId);
  await redis.quit();
}

async function waitForEmailStatus(
  id: string,
  statuses: string[],
  deadlineMs: number,
): Promise<Json> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const { status, body } = await api<Json>(`/emails/${id}`);
    if (status === 200 && statuses.includes(String(body.status))) {
      return body;
    }
    await sleep(POLL_MS);
  }
  throw new Error(`Timeout waiting for ${id} to reach ${statuses.join("|")}`);
}

/** Poll until every id reaches one of the statuses, or throw once the shared budget expires. */
async function waitForAllEmailStatuses(
  ids: string[],
  statuses: string[],
  timeoutMs: number,
): Promise<Map<string, Json>> {
  const deadline = Date.now() + timeoutMs;
  const results = new Map<string, Json>();

  while (Date.now() < deadline) {
    let allDone = true;
    for (const id of ids) {
      if (results.has(id)) {
        continue;
      }
      const { status, body } = await api<Json>(`/emails/${id}`);
      if (status === 200 && statuses.includes(String(body.status))) {
        results.set(id, body);
      } else {
        allDone = false;
      }
    }
    if (allDone) {
      return results;
    }
    await sleep(POLL_MS);
  }

  const pending = ids.filter((id) => !results.has(id));
  throw new Error(
    `Timeout waiting for ${pending.length} email(s): ${pending.join(", ")} → ${statuses.join("|")}`,
  );
}

async function main(): Promise<void> {
  const results: boolean[] = [];

  console.log(`\n=== Integration tests (API ${API}, run ${RUN_ID}) ===\n`);

  const health = await api("/health");
  const healthOk = health.status === 200;
  logResult("API health", healthOk);
  results.push(healthOk);
  if (!healthOk) {
    console.error("Start API: npm run dev -w @reachinbox/api");
    process.exit(1);
  }

  // ── Phase 1: single send (isolated sender, clean rate-limit keys) ─────────
  const singleSenderId = await createTestSender("integration-single", {
    hourlyLimit: 50,
    minDelayMs: 500,
  });
  await clearSenderRateLimitState(singleSenderId);
  logResult("Create isolated sender (single send)", true, singleSenderId);

  const scheduledAt = new Date(Date.now() + 5_000).toISOString();
  const scheduleRes = await api<Json>("/emails", {
    method: "POST",
    body: JSON.stringify({
      senderAccountId: singleSenderId,
      to: "integration-recipient@example.com",
      subject: `Integration single send ${RUN_ID}`,
      body: "Hello from ReachInbox integration test",
      scheduledAt,
    }),
  });
  const scheduleOk = scheduleRes.status === 201;
  logResult("Schedule single email via API", scheduleOk);
  results.push(scheduleOk);
  if (!scheduleOk) {
    console.error(scheduleRes.body);
    process.exit(1);
  }
  const emailId = String(scheduleRes.body.id);

  try {
    const singleSent = await waitForEmailStatus(emailId, ["SENT"], 120_000);
    const sentOk =
      singleSent.status === "SENT" && Boolean(singleSent.smtpMessageId);
    logResult(
      "BullMQ worker sends via Ethereal → SENT in Postgres",
      sentOk,
      `smtpMessageId=${singleSent.smtpMessageId}`,
    );
    results.push(sentOk);
  } catch (e) {
    logResult(
      "BullMQ worker sends via Ethereal → SENT in Postgres",
      false,
      e instanceof Error ? e.message : String(e),
    );
    results.push(false);
  }

  // ── Phase 2: postponement (dedicated sender; min-delay + campaign order) ─
  const postponeSenderId = await createTestSender("integration-postpone", {
    hourlyLimit: 50,
    minDelayMs: 3_000,
  });
  await clearSenderRateLimitState(postponeSenderId);

  const campaignRes = await api<Json>("/campaigns", {
    method: "POST",
    body: JSON.stringify({
      name: `campaign-postpone-${RUN_ID}`,
      senderAccountId: postponeSenderId,
    }),
  });
  const campaignOk = campaignRes.status === 201;
  logResult("Create campaign (postponement phase)", campaignOk);
  results.push(campaignOk);
  const campaignId = campaignOk ? String(campaignRes.body.id) : "";

  const postponeIds: string[] = [];
  const postponeStart = new Date(Date.now() + 2_000).toISOString();
  for (let i = 0; i < 4; i++) {
    const r = await api<Json>("/emails", {
      method: "POST",
      body: JSON.stringify({
        senderAccountId: postponeSenderId,
        campaignId,
        sequenceOrder: i,
        to: `postpone${i}-${RUN_ID}@example.com`,
        subject: `Postpone ${i}`,
        body: `Postpone message ${i}`,
        scheduledAt: postponeStart,
      }),
    });
    if (r.status === 201) {
      postponeIds.push(String(r.body.id));
    }
  }
  logResult("Schedule 4 campaign emails (postponement probe)", postponeIds.length === 4);
  results.push(postponeIds.length === 4);

  const postponeDeadline = Date.now() + 20_000;
  let postponedObserved = false;
  while (Date.now() < postponeDeadline) {
    const details: Json[] = [];
    for (const id of postponeIds) {
      const { body } = await api<Json>(`/emails/${id}`);
      details.push(body);
    }
    postponedObserved = details.some((e) => e.lastPostponedAt != null);
    const sentCount = details.filter((e) => e.status === "SENT").length;
    if (postponedObserved || sentCount >= 2) {
      break;
    }
    await sleep(POLL_MS);
  }
  logResult(
    "Rate limit / ordering postpones without dropping",
    postponedObserved,
    postponedObserved
      ? "lastPostponedAt set on at least one job"
      : "no postponement observed within 20s (worker may be slow)",
  );
  results.push(postponedObserved);

  // ── Phase 3: concurrent delivery (fresh sender, no shared hourly bucket) ───
  const deliverySenderId = await createTestSender("integration-delivery", {
    hourlyLimit: 50,
    minDelayMs: 800,
  });
  await clearSenderRateLimitState(deliverySenderId);

  const burstIds: string[] = [];
  const burstStart = new Date(Date.now() + 2_000).toISOString();
  for (let i = 0; i < 4; i++) {
    const r = await api<Json>("/emails", {
      method: "POST",
      body: JSON.stringify({
        senderAccountId: deliverySenderId,
        to: `burst${i}-${RUN_ID}@example.com`,
        subject: `Burst ${i}`,
        body: `Burst message ${i}`,
        scheduledAt: burstStart,
      }),
    });
    if (r.status === 201) {
      burstIds.push(String(r.body.id));
    }
  }
  logResult("Schedule 4 parallel emails (delivery phase)", burstIds.length === 4);
  results.push(burstIds.length === 4);

  let burstSentCount = 0;
  try {
    const burstFinal = await waitForAllEmailStatuses(
      burstIds,
      ["SENT"],
      DELIVERY_PHASE_TIMEOUT_MS,
    );
    burstSentCount = burstFinal.size;
    logResult(
      "Burst emails eventually delivered",
      burstSentCount === burstIds.length,
      `${burstSentCount}/${burstIds.length} SENT within ${DELIVERY_PHASE_TIMEOUT_MS / 1000}s`,
    );
    results.push(burstSentCount === burstIds.length);
  } catch (e) {
    for (const id of burstIds) {
      const { body } = await api<Json>(`/emails/${id}`);
      if (body.status === "SENT") {
        burstSentCount += 1;
      }
    }
    logResult(
      "Burst emails eventually delivered",
      false,
      `${burstSentCount}/${burstIds.length} SENT — ${e instanceof Error ? e.message : String(e)}`,
    );
    results.push(false);
  }

  const listScheduled = await api<{ data: Json[] }>("/emails?status=scheduled");
  const listSent = await api<{ data: Json[] }>("/emails?status=sent");
  const listOk =
    listScheduled.status === 200 &&
    listSent.status === 200 &&
    Array.isArray(listScheduled.body.data) &&
    Array.isArray(listSent.body.data);
  logResult(
    "List scheduled / sent APIs",
    listOk,
    listOk
      ? `scheduled=${listScheduled.body.data.length} sent=${listSent.body.data.length}`
      : `scheduled=${listScheduled.status} sent=${listSent.status}`,
  );
  results.push(listOk);

  console.log("\n=== Summary ===\n");
  const passed = results.filter(Boolean).length;
  console.log(`${passed}/${results.length} checks passed`);
  if (!results.every(Boolean)) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
