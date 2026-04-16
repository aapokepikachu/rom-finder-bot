import { Context, MiddlewareFn } from 'telegraf';
import { logger } from '../utils/logger';

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const rateLimitMap = new Map<number, RateLimitEntry>();
const WINDOW_MS = 60 * 1000; // 1 minute
const MAX_REQUESTS = 20; // per window

// Cleanup every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitMap.entries()) {
    if (entry.resetAt < now) rateLimitMap.delete(key);
  }
}, 5 * 60 * 1000);

export function rateLimiter(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) return next();

    const now = Date.now();
    const entry = rateLimitMap.get(userId);

    if (!entry || entry.resetAt < now) {
      rateLimitMap.set(userId, { count: 1, resetAt: now + WINDOW_MS });
      return next();
    }

    if (entry.count >= MAX_REQUESTS) {
      const waitSec = Math.ceil((entry.resetAt - now) / 1000);
      logger.warn(`Rate limit hit for user ${userId}`);
      await ctx.reply(`⚠️ Too many requests. Please wait ${waitSec}s before trying again.`);
      return;
    }

    entry.count++;
    return next();
  };
}
