/**
 * /backfill — Admin command to index historical messages from channels.
 *
 * The Telegram Bot API does NOT provide a getHistory method for bots.
 * The only reliable way to read old channel messages is via `forwardMessages`
 * or by using the channel's message IDs sequentially with `copyMessage`.
 *
 * Strategy used here:
 *   1. For each configured channel, attempt to copy/forward messages by ID
 *      starting from ID 1 up to a reasonable ceiling, in batches.
 *   2. On each successful copy we extract the file + caption and index it,
 *      then immediately delete the copied message from the bot's chat.
 *   3. Gaps (deleted/non-existent messages) are skipped gracefully.
 *
 * NOTE: The bot must be an ADMIN in the channel with "Post Messages" rights.
 * The bot will copy messages into the admin's private chat to read them,
 * then delete them. This is the only workaround for the Bot API limitation.
 *
 * Alternatively, admins can use /backfill_file to upload a JSON export
 * (from Telegram Desktop "Export chat history") for zero-rate-limit indexing.
 */

import { Context, Telegraf } from 'telegraf';
import { ChannelMessage } from '../models/ChannelMessage';
import { Channel } from '../models/Channel';
import { cacheService } from '../services/cache';
import { config } from '../config';
import { extractCategory, extractFileName, sleep } from '../utils/helpers';
import { logger } from '../utils/logger';

interface BackfillStats {
  indexed: number;
  skipped: number;
  errors: number;
  lastId: number;
}

// Per-admin backfill lock so it can't be run twice simultaneously
const backfillRunning = new Set<number>();

export async function backfillCommand(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;

  if (backfillRunning.has(userId)) {
    await ctx.reply('⚠️ A backfill is already running. Please wait for it to finish.');
    return;
  }

  const allChannels = config.CHANNELS;
  if (allChannels.length === 0) {
    await ctx.reply('⚠️ No channels configured in CHANNELS env variable.');
    return;
  }

  // Show channel selection
  const keyboard = {
    inline_keyboard: [
      ...allChannels.map((id) => [
        { text: `📡 ${id}`, callback_data: `backfill_chan:${id}` },
      ]),
      [{ text: '📡 All Channels', callback_data: 'backfill_chan:ALL' }],
      [{ text: '❌ Cancel', callback_data: 'admin_cancel' }],
    ],
  };

  await ctx.reply(
    `🔄 *Backfill Historical Messages*\n\n` +
    `This will scan old messages in a channel and index any files found\\.\n\n` +
    `⚠️ *Requirements:*\n` +
    `• Bot must be admin in the channel\n` +
    `• May take several minutes for large channels\n` +
    `• Rate limited to ~1 msg/sec to avoid Telegram limits\n\n` +
    `Select a channel to backfill:`,
    { parse_mode: 'MarkdownV2', reply_markup: keyboard }
  );
}

export async function runBackfill(
  ctx: Context,
  bot: Telegraf,
  channelId: string
): Promise<void> {
  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;

  if (backfillRunning.has(userId)) {
    await ctx.answerCbQuery('Already running!');
    return;
  }

  await ctx.answerCbQuery('🔄 Starting backfill...');
  backfillRunning.add(userId);

  const channelsToProcess = channelId === 'ALL' ? config.CHANNELS : [channelId];

  const statusMsg = await bot.telegram.sendMessage(
    chatId,
    `🔄 Starting backfill for ${channelsToProcess.length} channel(s)...\n\nThis may take a while. I'll update you on progress.`
  );

  let totalStats: BackfillStats = { indexed: 0, skipped: 0, errors: 0, lastId: 0 };

  try {
    for (const chId of channelsToProcess) {
      await bot.telegram.editMessageText(
        chatId,
        statusMsg.message_id,
        undefined,
        `🔄 Scanning channel ${chId}...\n\n` +
        `Indexed so far: ${totalStats.indexed}`
      );

      const stats = await backfillChannel(bot, chatId, chId, async (progress) => {
        // Update status every 50 messages
        if (progress.indexed % 50 === 0 && progress.indexed > 0) {
          await bot.telegram.editMessageText(
            chatId,
            statusMsg.message_id,
            undefined,
            `🔄 Scanning ${chId}...\n\n` +
            `✅ Indexed: ${progress.indexed}\n` +
            `⏭️ Skipped: ${progress.skipped}\n` +
            `🔢 Current ID: ${progress.lastId}`
          ).catch(() => {});
        }
      });

      totalStats.indexed += stats.indexed;
      totalStats.skipped += stats.skipped;
      totalStats.errors += stats.errors;

      logger.info(`Backfill complete for ${chId}: ${stats.indexed} indexed, ${stats.skipped} skipped`);
    }

    cacheService.invalidate();

    await bot.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `✅ *Backfill Complete\\!*\n\n` +
      `📊 *Results:*\n` +
      `• ✅ Files indexed: *${totalStats.indexed}*\n` +
      `• ⏭️ Skipped \\(no file/duplicate\\): *${totalStats.skipped}*\n` +
      `• ❌ Errors: *${totalStats.errors}*\n\n` +
      `You can now /search for any of the indexed ROMs\\.`,
      { parse_mode: 'MarkdownV2' }
    );
  } catch (err) {
    logger.error('Backfill error:', err);
    await bot.telegram.editMessageText(
      chatId,
      statusMsg.message_id,
      undefined,
      `❌ Backfill failed: ${String(err)}\n\nPartially indexed: ${totalStats.indexed} files.`
    ).catch(() => {});
  } finally {
    backfillRunning.delete(userId);
  }
}

async function backfillChannel(
  bot: Telegraf,
  adminChatId: number,
  channelId: string,
  onProgress: (stats: BackfillStats) => Promise<void>
): Promise<BackfillStats> {
  const stats: BackfillStats = { indexed: 0, skipped: 0, errors: 0, lastId: 0 };

  // Find highest already-indexed message ID to resume from
  const latest = await ChannelMessage.findOne(
    { channelId },
    'messageId'
  ).sort({ messageId: -1 }).lean();

  let startId = latest ? latest.messageId + 1 : 1;
  const MAX_CONSECUTIVE_MISSES = 50; // stop if 50 IDs in a row have no message
  let consecutiveMisses = 0;
  let currentId = startId;

  logger.info(`Backfill ${channelId}: starting from message ID ${startId}`);

  while (consecutiveMisses < MAX_CONSECUTIVE_MISSES) {
    stats.lastId = currentId;

    try {
      // Copy the message from the channel to admin's private chat
      // This is the only Bot API method that lets us "read" historical messages
      const copied = await bot.telegram.copyMessage(
        adminChatId,
        channelId,
        currentId
      );

      // We got a message — but we need the file info, so forward instead of copy
      // Actually we need to use forwardMessage to get the original file_id
      const forwarded = await bot.telegram.forwardMessage(
        adminChatId,
        channelId,
        currentId
      );

      // Delete the copy we made (clean up admin chat)
      await bot.telegram.deleteMessage(adminChatId, copied.message_id).catch(() => {});

      // Extract file info from the forwarded message
      const msg = forwarded as any;
      const fileObj = msg.document || msg.video || msg.audio;

      if (fileObj) {
        const caption: string = msg.caption || '';
        const fileName = fileObj.file_name || extractFileNameFromCaption(caption) || `file_${currentId}`;
        const fileSize: number | undefined = fileObj.file_size;
        const fileId: string = fileObj.file_id;

        // Get category from channel mapping
        const channelMapping = await Channel.findOne({ channelId }, 'label').lean();
        const category = channelMapping?.label || extractCategory(caption);

        try {
          await ChannelMessage.findOneAndUpdate(
            { channelId, messageId: currentId },
            {
              $set: {
                fileName,
                caption,
                category,
                fileSize,
                fileId,
                receivedAt: new Date(),
              },
            },
            { upsert: true }
          );
          stats.indexed++;
        } catch (dbErr: any) {
          if (dbErr.code !== 11000) {
            logger.warn(`DB error indexing ${channelId}/${currentId}:`, dbErr);
            stats.errors++;
          } else {
            stats.skipped++; // Already exists
          }
        }
      } else {
        stats.skipped++; // Text-only message
      }

      // Delete forwarded message from admin chat
      await bot.telegram.deleteMessage(adminChatId, forwarded.message_id).catch(() => {});
      consecutiveMisses = 0;

    } catch (err: any) {
      const errMsg: string = err?.description || err?.message || '';

      if (
        errMsg.includes('message to forward not found') ||
        errMsg.includes('MESSAGE_ID_INVALID') ||
        errMsg.includes('message not found')
      ) {
        consecutiveMisses++;
        stats.skipped++;
      } else if (errMsg.includes('Too Many Requests')) {
        // Rate limited — wait and retry
        const retryAfter = err?.parameters?.retry_after || 5;
        logger.warn(`Rate limited, waiting ${retryAfter}s...`);
        await sleep(retryAfter * 1000);
        continue; // Don't increment currentId
      } else if (errMsg.includes("bot can't initiate") || errMsg.includes('PEER_ID_INVALID')) {
        // Can't access channel at all
        logger.error(`Cannot access channel ${channelId}: ${errMsg}`);
        break;
      } else {
        stats.errors++;
        consecutiveMisses++;
        logger.debug(`Error at ${channelId}/${currentId}: ${errMsg}`);
      }
    }

    await onProgress(stats);
    currentId++;

    // Small delay to respect Telegram rate limits (30 msg/sec allowed, we do ~3/sec)
    await sleep(350);
  }

  return stats;
}

function extractFileNameFromCaption(caption: string): string | undefined {
  const match = caption.match(
    /([^\n\s]+\.(zip|7z|rar|rom|iso|nds|gba|3ds|cso|elf|bin|sfc|smc|gb|gbc|n64|z64|v64))/i
  );
  return match?.[1];
}
