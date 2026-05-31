import { Context, Telegraf } from 'telegraf';
import { ChannelMessage } from '../models/ChannelMessage';
import { Channel } from '../models/Channel';
import { cacheService } from '../services/cache';
import { config } from '../config';
import { extractCategory, sleep, buildCleanName, isFallbackFileName } from '../utils/helpers';
import { captionHasBlockedTag } from '../utils/blockedTags';
import { logger } from '../utils/logger';

interface BackfillStats {
  indexed: number;
  skipped: number;
  errors: number;
  lastId: number;
}

// Prevent concurrent runs per admin
const backfillRunning = new Set<number>();

export async function backfillCommand(ctx: Context): Promise<void> {
  const userId = ctx.from!.id;

  if (backfillRunning.has(userId)) {
    await ctx.reply('⚠️ A backfill is already running. Please wait for it to finish.');
    return;
  }

  const allChannels = config.CHANNELS;
  if (allChannels.length === 0) {
    await ctx.reply(
      '⚠️ No channels found in <code>CHANNELS</code> environment variable.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const rows = allChannels.map((id) => [{
    text: `📡 ${id}`,
    callback_data: `backfill_start:${id}`,
  }]);
  rows.push([{ text: '📡 All Channels', callback_data: 'backfill_start:ALL' }]);
  rows.push([{ text: '❌ Cancel',        callback_data: 'admin_cancel'        }]);

  await ctx.reply(
    `🔄 <b>Backfill Historical Messages</b>\n\n` +
    `Scans old channel messages and indexes any file found.\n\n` +
    `<b>Requirements:</b>\n` +
    `• Bot must be <b>admin</b> in the channel\n` +
    `• Takes ~1 sec per message (rate limit safe)\n` +
    `• Can be stopped and re-run safely\n\n` +
    `Select a channel to backfill:`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }
  );
}

export async function runBackfill(
  ctx: Context,
  bot: Telegraf,
  channelId: string
): Promise<void> {
  const userId = ctx.from!.id;
  const chatId = ctx.chat!.id;

  if (backfillRunning.has(userId)) return;
  backfillRunning.add(userId);

  const channelsToProcess = channelId === 'ALL' ? config.CHANNELS : [channelId];

  const statusMsg = await bot.telegram.sendMessage(
    chatId,
    `🔄 Starting backfill for ${channelsToProcess.length} channel(s)...\nThis may take several minutes.`
  );

  let total: BackfillStats = { indexed: 0, skipped: 0, errors: 0, lastId: 0 };

  try {
    for (const chId of channelsToProcess) {
      await bot.telegram.editMessageText(
        chatId, statusMsg.message_id, undefined,
        `🔄 Scanning channel <code>${chId}</code>...\n\nIndexed so far: <b>${total.indexed}</b>`,
        { parse_mode: 'HTML' }
      ).catch(() => {});

      const stats = await backfillChannel(bot, chatId, chId, async (p) => {
        if (p.indexed > 0 && p.indexed % 50 === 0) {
          await bot.telegram.editMessageText(
            chatId, statusMsg.message_id, undefined,
            `🔄 Scanning <code>${chId}</code>...\n\n` +
            `✅ Indexed: <b>${p.indexed}</b>\n` +
            `⏭️ Skipped: <b>${p.skipped}</b>\n` +
            `🔢 At message ID: <b>${p.lastId}</b>`,
            { parse_mode: 'HTML' }
          ).catch(() => {});
        }
      });

      total.indexed += stats.indexed;
      total.skipped += stats.skipped;
      total.errors  += stats.errors;
    }

    cacheService.invalidate();

    await bot.telegram.editMessageText(
      chatId, statusMsg.message_id, undefined,
      `✅ <b>Backfill Complete!</b>\n\n` +
      `• Files indexed: <b>${total.indexed}</b>\n` +
      `• Skipped (no file / duplicate): <b>${total.skipped}</b>\n` +
      `• Errors: <b>${total.errors}</b>\n\n` +
      `You can now /search for any indexed ROM.`,
      { parse_mode: 'HTML' }
    ).catch(() => {});
  } catch (err) {
    logger.error('Backfill error:', err);
    await bot.telegram.editMessageText(
      chatId, statusMsg.message_id, undefined,
      `❌ Backfill failed: ${String(err)}\n\nPartially indexed: ${total.indexed} files.`
    ).catch(() => {});
  } finally {
    backfillRunning.delete(userId);
  }
}

async function backfillChannel(
  bot: Telegraf,
  adminChatId: number,
  channelId: string,
  onProgress: (s: BackfillStats) => Promise<void>
): Promise<BackfillStats> {
  const stats: BackfillStats = { indexed: 0, skipped: 0, errors: 0, lastId: 0 };

  // Resume from last indexed message ID
  const latest = await ChannelMessage.findOne({ channelId }, 'messageId')
    .sort({ messageId: -1 }).lean();
  let currentId = latest ? latest.messageId + 1 : 1;

  const MAX_CONSECUTIVE_MISSES = 50;
  let consecutiveMisses = 0;

  // Get channel label for category tagging
  const channelMapping = await Channel.findOne({ channelId }, 'label').lean();

  logger.info(`Backfill ${channelId}: starting from message ID ${currentId}`);

  while (consecutiveMisses < MAX_CONSECUTIVE_MISSES) {
    stats.lastId = currentId;

    try {
      // forwardMessage is the ONLY Bot API method that returns the full Message
      // object for channel posts (including file metadata). copyMessage only
      // returns a MessageId stub with no file info.
      const forwarded = await bot.telegram.forwardMessage(
        adminChatId,
        channelId,
        currentId
      ) as any;

      const fileObj = forwarded.document || forwarded.video || forwarded.audio;

      if (fileObj) {
        const caption: string = forwarded.caption || '';

        // Skip files with blocked tags
        if (await captionHasBlockedTag(caption)) {
          stats.skipped++;
          await bot.telegram.deleteMessage(adminChatId, forwarded.message_id).catch(() => {});
          consecutiveMisses = 0;
          currentId++;
          await sleep(380);
          continue;
        }
        const rawName =
          fileObj.file_name ||
          extractFileNameFromCaption(caption) ||
          `file_${channelId}_${currentId}`;

        // Skip entries with no real filename — they are photos or unknown files
        if (isFallbackFileName(rawName)) {
          stats.skipped++;
          await bot.telegram.deleteMessage(adminChatId, forwarded.message_id).catch(() => {});
          consecutiveMisses = 0;
          currentId++;
          await sleep(380);
          continue;
        }

        const fileName  = rawName;
        const cleanName = buildCleanName(rawName);

        const category =
          channelMapping?.label ||
          extractCategory(caption);

        try {
          await ChannelMessage.findOneAndUpdate(
            { channelId, messageId: currentId },
            {
              $set: {
                fileName,
                cleanName,
                caption,
                category,
                fileSize: fileObj.file_size,
                fileId:   fileObj.file_id,
                receivedAt: new Date(),
              },
            },
            { upsert: true }
          );
          stats.indexed++;
        } catch (dbErr: any) {
          if (dbErr.code === 11000) {
            stats.skipped++; // already indexed
          } else {
            stats.errors++;
            logger.warn(`DB error at ${channelId}/${currentId}:`, dbErr);
          }
        }
      } else {
        stats.skipped++; // text-only message
      }

      // Delete the forwarded copy from admin's chat to keep it clean
      await bot.telegram.deleteMessage(adminChatId, forwarded.message_id).catch(() => {});
      consecutiveMisses = 0;

    } catch (err: any) {
      const msg: string = err?.description || err?.message || String(err);

      if (
        msg.includes('message to forward not found') ||
        msg.includes('MESSAGE_ID_INVALID') ||
        msg.includes('message not found')
      ) {
        consecutiveMisses++;
        stats.skipped++;
      } else if (msg.includes('Too Many Requests') || msg.includes('FLOOD_WAIT')) {
        const wait = (err?.parameters?.retry_after ?? 5) + 1;
        logger.warn(`Rate limited, waiting ${wait}s...`);
        await sleep(wait * 1000);
        continue; // retry same ID
      } else if (
        msg.includes("bot can't initiate") ||
        msg.includes('PEER_ID_INVALID') ||
        msg.includes('chat not found') ||
        msg.includes('Forbidden')
      ) {
        logger.error(`Cannot access channel ${channelId}: ${msg}`);
        stats.errors++;
        break; // unrecoverable
      } else {
        stats.errors++;
        consecutiveMisses++;
        logger.debug(`Error at ${channelId}/${currentId}: ${msg}`);
      }
    }

    await onProgress(stats);
    currentId++;
    await sleep(380); // ~2.6 msg/sec, well within Telegram's 30/sec limit
  }

  logger.info(
    `Backfill ${channelId} done: ${stats.indexed} indexed, ` +
    `${stats.skipped} skipped, ${stats.errors} errors`
  );
  return stats;
}

function extractFileNameFromCaption(caption: string): string | undefined {
  const match = caption.match(
    /([^\n\s]+\.(zip|7z|rar|rom|iso|nds|gba|3ds|cso|elf|bin|sfc|smc|gb|gbc|n64|z64|v64))/i
  );
  return match?.[1];
}
