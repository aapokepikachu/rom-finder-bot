import { Context, MiddlewareFn } from 'telegraf';
import { config } from '../config';
import { logger } from '../utils/logger';

export function adminOnly(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const userId = ctx.from?.id;

    if (!userId || !config.ADMIN_IDS.includes(userId)) {
      logger.warn(`Unauthorized access attempt by user ${userId}`);
      await ctx.reply('⛔ This command is restricted to administrators.');
      return;
    }

    return next();
  };
}

export function isAdmin(userId?: number): boolean {
  if (!userId) return false;
  return config.ADMIN_IDS.includes(userId);
}
