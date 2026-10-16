import type { Redis } from "ioredis";

const HOUR_SECONDS = 3600;

/**
 * Atomically checks per-sender hourly cap and minimum gap between sends.
 * Returns acquired=1 when the worker may send now; otherwise retryAfterMs > 0.
 */
const TRY_ACQUIRE_SEND_SLOT = `
local hourlyKey = KEYS[1]
local lastSendKey = KEYS[2]
local hourlyLimit = tonumber(ARGV[1])
local minDelayMs = tonumber(ARGV[2])
local nowMs = tonumber(ARGV[3])
local hourTtl = tonumber(ARGV[4])

local count = tonumber(redis.call('GET', hourlyKey) or '0')
if count >= hourlyLimit then
  local ttl = redis.call('TTL', hourlyKey)
  if ttl < 0 then ttl = hourTtl end
  return {0, ttl * 1000}
end

local last = tonumber(redis.call('GET', lastSendKey) or '0')
if last > 0 then
  local wait = minDelayMs - (nowMs - last)
  if wait > 0 then
    return {0, wait}
  end
end

redis.call('INCR', hourlyKey)
if redis.call('TTL', hourlyKey) < 0 then
  redis.call('EXPIRE', hourlyKey, hourTtl)
end
redis.call('SET', lastSendKey, nowMs)
return {1, 0}
`;

export type SendSlotResult =
  | { acquired: true }
  | { acquired: false; retryAfterMs: number };

function hourBucketKey(senderAccountId: string, at: Date): string {
  const bucket = Math.floor(at.getTime() / (HOUR_SECONDS * 1000));
  return `sender:${senderAccountId}:hour:${bucket}`;
}

function lastSendKey(senderAccountId: string): string {
  return `sender:${senderAccountId}:lastSendMs`;
}

export async function tryAcquireSenderSendSlot(
  redis: Redis,
  senderAccountId: string,
  hourlyLimit: number,
  minDelayMs: number,
  now = new Date(),
): Promise<SendSlotResult> {
  const result = (await redis.eval(
    TRY_ACQUIRE_SEND_SLOT,
    2,
    hourBucketKey(senderAccountId, now),
    lastSendKey(senderAccountId),
    hourlyLimit,
    minDelayMs,
    now.getTime(),
    HOUR_SECONDS,
  )) as [number, number];

  const [acquired, retryAfterMs] = result;
  if (acquired === 1) {
    return { acquired: true };
  }
  return { acquired: false, retryAfterMs: Math.max(50, Math.ceil(retryAfterMs)) };
}

/** Test helper: clear sender rate-limit keys */
export async function resetSenderRateLimits(redis: Redis, senderAccountId: string): Promise<void> {
  const pattern = `sender:${senderAccountId}:*`;
  let cursor = "0";
  do {
    const [next, keys] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = next;
    if (keys.length > 0) {
      await redis.del(...keys);
    }
  } while (cursor !== "0");
}
