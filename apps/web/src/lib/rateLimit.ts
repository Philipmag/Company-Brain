/**
 * Per-org hourly rate limiting on chat (spec §8). Backed by a Redis counter
 * with a 1-hour TTL. Fails open if Redis is unavailable so a Redis outage does
 * not take down chat.
 */
import { Redis } from "ioredis";
import { env, planLimits } from "@company-brain/shared";

let redis: Redis | null = null;
function getRedis(): Redis {
  if (!redis) redis = new Redis(env.redisUrl, { maxRetriesPerRequest: 2 });
  return redis;
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
}

export async function checkChatRateLimit(
  orgId: string,
  planTier: string,
): Promise<RateLimitResult> {
  const limit = planLimits(planTier).questionsPerHour;
  try {
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const key = `ratelimit:chat:${orgId}:${hourBucket}`;
    const count = await getRedis().incr(key);
    if (count === 1) {
      await getRedis().expire(key, 3600);
    }
    return { allowed: count <= limit, limit, remaining: Math.max(0, limit - count) };
  } catch {
    // Fail open.
    return { allowed: true, limit, remaining: limit };
  }
}
