import { Context } from 'telegraf';
import { logger } from '../utils/logger';

export async function errorHandler(err: unknown, ctx: Context): Promise<void> {
  logger.error(`Error for update ${ctx.update?.update_id}:`, err);

  try {
    if (ctx.callbackQuery) {
      await ctx.answerCbQuery('❌ Something went wrong. Please try again.', {
        show_alert: false,
      });
    } else if (ctx.chat) {
      await ctx.reply(
        '❌ An unexpected error occurred. Please try again or use /help for assistance.'
      );
    }
  } catch (replyError) {
    logger.error('Could not send error message to user:', replyError);
  }
}
