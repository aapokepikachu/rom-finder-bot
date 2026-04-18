import { Context, MiddlewareFn } from 'telegraf';
import { logger } from '../utils/logger';

/**
 * Per-user sliding-window rate limiter.
 *
 * Why this matters for a ROM-finder bot:
 *  - Prevents a single user from hammering /search and flooding the DB + in-memory index
 *  - Protects Telegram bot API quota (30 msg/sec global; this keeps individual users reasonable)
 *  - Stops abuse loops (e.g. bots scripting /search repeatedly)
 *  - Keeps Render free-tier CPU/memory within limits
 *
 * Limits (tuned for a ROM search bot):
 *  - 15 requests / 60 seconds for regular users  (generous for normal use)
 *  - Admins are exempt — they need to run /backfill, /broadcast, etc. unthrottled
 *  - Channel posts (indexing) are exempt — not user-initiated
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<number, RateLimitEntry>();

const WINDOW_MS    = 60 * 1000; // 1-minute window
const MAX_REQUESTS = 15;         // per window per user

// Prune expired entries every 5 minutes to prevent memory leak
setInterval(() => {
  const now = Date.now();
  for (const [userId, entry] of rateLimitMap.entries()) {
    if (entry.resetAt < now) rateLimitMap.delete(userId);
  }
}, 5 * 60 * 1000);

export function rateLimiter(adminIds: number[] = []): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    // No user context (channel posts, etc.) — always pass through
    if (!userId) return next();

    // Admins are always exempt
    if (adminIds.includes(userId)) return next();

    const now   = Date.now();
    const entry = rateLimitMap.get(userId);

    // New window
    if (!entry || entry.resetAt < now) {
      rateLimitMap.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }

    // Within window and under limit
    if (entry.count < MAX_REQUESTS) {
      entry.count++;
      return next();
    }

    // Over limit
    const waitSec = Math.ceil((entry.resetAt - now) / 1000);
    logger.warn(`Rate limit hit: user ${userId} (${entry.count} requests in window)`);

    // Only send the warning once (when count first exceeds limit)
    if (entry.count === MAX_REQUESTS) {
      entry.count++; // increment so this block only fires once
      await ctx.reply(
        `⏳ <b>Slow down!</b>\n\n` +
        `You've sent too many requests. Please wait <b>${waitSec}s</b> before trying again.`,
        { parse_mode: 'HTML' }
      );
    }
    // Subsequent requests in the same window are silently dropped
  };
}
