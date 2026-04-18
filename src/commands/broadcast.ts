import { Context, Telegraf } from 'telegraf';
import { User } from '../models/User';
import { setSession, clearSession, getSession, BroadcastParseMode } from '../services/session';
import { sleep } from '../utils/helpers';
import { logger } from '../utils/logger';

// ── Step 1: Admin sends /broadcast ────────────────────────────────────────

export async function broadcastCommand(ctx: Context): Promise<void> {
  setSession(ctx.from!.id, { step: 'broadcast_compose' });

  await ctx.reply(
    `📢 <b>Broadcast Message</b>\n\n` +
    `Type the message you want to send to all users.\n\n` +
    `<b>Formatting tips:</b>\n` +
    `• <b>HTML:</b> use <code>&lt;b&gt;bold&lt;/b&gt;</code>, <code>&lt;i&gt;italic&lt;/i&gt;</code>, <code>&lt;code&gt;mono&lt;/code&gt;</code>, <code>&lt;a href="url"&gt;link&lt;/a&gt;</code>\n` +
    `• <b>Markdown:</b> use <code>*bold*</code>, <code>_italic_</code>, <code>\`mono\`</code>, <code>[text](url)</code>\n` +
    `• <b>Plain text:</b> no formatting — safest option\n\n` +
    `You'll choose the format <i>after</i> typing your message.\n\n` +
    `<i>Send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Step 2: Admin typed the message — ask for format ─────────────────────

export async function handleBroadcastPickFormat(ctx: Context, message: string): Promise<void> {
  setSession(ctx.from!.id, { step: 'broadcast_pick_format', message });

  await ctx.reply(
    `📋 <b>Message received.</b>\n\nChoose the formatting mode to render it with:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📄 Plain Text (no formatting)', callback_data: 'bcast_fmt:none'     }],
          [{ text: '🏷️ HTML (<b>, <i>, <a> etc.)',  callback_data: 'bcast_fmt:HTML'     }],
          [{ text: '✏️ Markdown (*bold*, _italic_)',  callback_data: 'bcast_fmt:Markdown' }],
          [{ text: '❌ Cancel',                        callback_data: 'admin_cancel'       }],
        ],
      },
    }
  );
}

// ── Step 3: Admin picked format — validate + show preview ────────────────

export async function handleBroadcastPreview(
  ctx: Context,
  message: string,
  parseMode: BroadcastParseMode
): Promise<void> {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;

  // Validate: attempt to send the message to the admin themselves first.
  // If Telegram rejects the formatting, we catch the error and explain it
  // instead of crashing mid-broadcast.
  const sendOptions: any = parseMode !== 'none' ? { parse_mode: parseMode } : {};

  try {
    const testMsg = await ctx.telegram.sendMessage(
      userId,
      message,
      { ...sendOptions, disable_notification: true }
    );

    // Delete the test message immediately — it was only for validation
    await ctx.telegram.deleteMessage(userId, testMsg.message_id).catch(() => {});
  } catch (err: any) {
    const errDesc: string = err?.description || err?.message || String(err);

    // Formatting error — explain it to the admin
    await ctx.reply(
      `❌ <b>Formatting Error</b>\n\n` +
      `Your message has invalid <b>${parseMode}</b> formatting and cannot be sent.\n\n` +
      `<b>Telegram says:</b>\n<code>${errDesc.replace(/</g,'&lt;')}</code>\n\n` +
      `<b>Common causes:</b>\n` +
      (parseMode === 'Markdown'
        ? `• Unclosed <code>*bold*</code> or <code>_italic_</code> — every opening symbol needs a closing one\n` +
          `• Underscore in words like <code>Pkmn_GBA</code> — escape it as <code>Pkmn\\_GBA</code> or use HTML mode instead\n` +
          `• Unescaped special chars: <code>[ ] ( )</code>\n`
        : `• Unclosed HTML tag — every <code>&lt;b&gt;</code> needs a <code>&lt;/b&gt;</code>\n` +
          `• Unescaped <code>&amp;</code> — write it as <code>&amp;amp;</code>\n`) +
      `\nUse /broadcast to try again with a corrected message.`,
      { parse_mode: 'HTML' }
    );
    clearSession(userId);
    return;
  }

  // Validation passed — store and show preview with confirm button
  setSession(userId, { step: 'broadcast_confirm', message, parseMode });

  const modeLabel =
    parseMode === 'none'     ? 'Plain Text' :
    parseMode === 'HTML'     ? 'HTML' : 'Markdown';

  // Show the preview rendered exactly as users will see it
  const previewOptions: any = parseMode !== 'none' ? { parse_mode: parseMode } : {};

  await ctx.reply(
    message,
    {
      ...previewOptions,
      reply_markup: {
        inline_keyboard: [
          [{ text: `📢 Send (${modeLabel})`, callback_data: 'broadcast:confirm' }],
          [{ text: '🔄 Change Format',       callback_data: 'broadcast:reformat' }],
          [{ text: '❌ Cancel',               callback_data: 'admin_cancel'       }],
        ],
      },
    }
  );

  // Send a plain-text caption above so the admin knows what they're looking at
  await ctx.reply(
    `⬆️ Preview rendered in <b>${modeLabel}</b> mode.\nThis is exactly what users will see.`,
    { parse_mode: 'HTML' }
  );
}

// ── Step 4: Confirmed — send to all users ────────────────────────────────

export async function executeBroadcast(
  ctx: Context,
  bot: Telegraf,
  message: string,
  parseMode: BroadcastParseMode
): Promise<void> {
  await ctx.answerCbQuery('📢 Broadcasting...').catch(() => {});

  const users = await User.find(
    { isBlocked: false, isDeleted: false },
    'userId'
  ).lean();

  let sent = 0, blocked = 0, failed = 0;
  const BATCH_DELAY = 35;
  const sendOptions: any = parseMode !== 'none' ? { parse_mode: parseMode } : {};

  const statusMsg = await ctx.reply(
    `📢 Broadcasting to <b>${users.length}</b> users...\n\nProgress: 0/${users.length}`,
    { parse_mode: 'HTML' }
  );

  for (let i = 0; i < users.length; i++) {
    const user = users[i];
    try {
      await bot.telegram.sendMessage(user.userId, message, sendOptions);
      sent++;
    } catch (error: any) {
      const errMsg: string = error?.description || error?.message || '';
      if (
        errMsg.includes('blocked') ||
        errMsg.includes('deactivated') ||
        errMsg.includes('user is deactivated')
      ) {
        await User.updateOne(
          { userId: user.userId },
          { $set: errMsg.includes('deactivated') ? { isDeleted: true } : { isBlocked: true } }
        );
        blocked++;
      } else {
        failed++;
        logger.warn(`Broadcast failed for ${user.userId}: ${errMsg}`);
      }
    }

    if (i > 0 && i % 50 === 0) {
      await bot.telegram.editMessageText(
        ctx.chat!.id, statusMsg.message_id, undefined,
        `📢 Broadcasting...\n\nProgress: ${i}/${users.length} (${sent} sent)`
      ).catch(() => {});
    }

    await sleep(BATCH_DELAY);
  }

  clearSession(ctx.from!.id);

  await bot.telegram.editMessageText(
    ctx.chat!.id, statusMsg.message_id, undefined,
    `✅ <b>Broadcast Complete!</b>\n\n` +
    `📤 Sent: <b>${sent}</b>\n` +
    `🚫 Blocked/Deleted: <b>${blocked}</b>\n` +
    `❌ Failed: <b>${failed}</b>\n` +
    `📊 Total: <b>${users.length}</b>`,
    { parse_mode: 'HTML' }
  ).catch(() => {});
}
