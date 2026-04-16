import { Context, MiddlewareFn } from 'telegraf';
import { User } from '../models/User';
import { logger } from '../utils/logger';

export function userTracker(): MiddlewareFn<Context> {
  return async (ctx, next) => {
    const from = ctx.from;
    if (!from || from.is_bot) return next();

    try {
      await User.findOneAndUpdate(
        { userId: from.id },
        {
          $set: {
            username: from.username,
            firstName: from.first_name,
            lastName: from.last_name,
            lastActiveAt: new Date(),
            isDeleted: false, // they're active again
          },
          $setOnInsert: {
            joinedAt: new Date(),
            isBlocked: false,
          },
        },
        { upsert: true, new: true }
      );
    } catch (error) {
      logger.warn('User tracker error:', error);
    }

    return next();
  };
}
