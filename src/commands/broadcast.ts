import { Context, Telegraf } from 'telegraf';
import { User } from '../models/User';
import { setSession, clearSession, getSession } from '../services/session';
import { buildBroadcastConfirmKeyboard } from '../utils/keyboards';
import { sleep } from '../utils/helpers';
import { logger } from '../utils/logger';

export async function broadcastCommand(ctx: Context): Promise<void> {
  const session = getSession(ctx.from!.id);

  // If already composing, reset
  setSession(ctx.from!.id, { step: 'broadcast_compose' });

  await ctx.reply(
    `📢 *Broadcast Message*\n\n` +
    `Please type the message you want to send to all users\\.\n` +
    `Supports Markdown formatting\\.\n\n` +
    `_Send /cancel to abort\\._`,
    { parse_mode: 'MarkdownV2' }
  );
}

export async function handleBroadcastPreview(ctx: Context, message: string): Promise<void> {
  setSession(ctx.from!.id, { step: 'broadcast_confirm', message });

  await ctx.reply(
    `📋 *Preview:*\n\n${message}\n\n` +
    `─────────────────\n` +
    `Send this to all active users?`,
    {
      parse_mode: 'Markdown',
      reply_markup: buildBroadcastConfirmKeyboard(),
    }
  );
}

export async function executeBroadcast(ctx: Context, bot: Telegraf, message: string): Promise<void> {
  await ctx.answerCbQuery('📢 Broadcasting...').catch(() => {});

  const users = await User.find(
    { isBlocked: false, isDeleted: false },
    'userId'
  ).lean();

  let sent = 0;
  let blocked = 0;
  let failed = 0;
  const BATCH_DELAY = 35; // ms between sends to avoid flood limits

  const statusMsg = await ctx.reply(
    `📢 Broadcasting to ${users.length} users...\n\n` +
    `Progress: 0/${users.length}`
  );

  for (let i = 0; i < users.length; i++) {
    const user = users[i];

    try {
      await bot.telegram.sendMessage(user.userId, message, {
        parse_mode: 'Markdown',
      });
      sent++;
    } catch (error: any) {
      const errMsg = error?.description || error?.message || '';

      if (
        errMsg.includes('blocked') ||
        errMsg.includes('deactivated') ||
        errMsg.includes('user is deactivated')
      ) {
        // Mark user accordingly
        await User.updateOne(
          { userId: user.userId },
          {
            $set: errMsg.includes('deactivated')
              ? { isDeleted: true }
              : { isBlocked: true },
          }
        );
        blocked++;
      } else {
        failed++;
        logger.warn(`Broadcast failed for user ${user.userId}: ${errMsg}`);
      }
    }

    // Update progress every 50 users
    if (i > 0 && i % 50 === 0) {
      await bot.telegram
        .editMessageText(
          ctx.chat!.id,
          statusMsg.message_id,
          undefined,
          `📢 Broadcasting...\n\nProgress: ${i}/${users.length} (${sent} sent)`
        )
        .catch(() => {});
    }

    await sleep(BATCH_DELAY);
  }

  clearSession(ctx.from!.id);

  await bot.telegram
    .editMessageText(
      ctx.chat!.id,
      statusMsg.message_id,
      undefined,
      `✅ *Broadcast Complete\\!*\n\n` +
      `📤 Sent: *${sent}*\n` +
      `🚫 Blocked/Deleted: *${blocked}*\n` +
      `❌ Failed: *${failed}*\n` +
      `📊 Total: *${users.length}*`,
      { parse_mode: 'MarkdownV2' }
    )
    .catch(() => {});
}
