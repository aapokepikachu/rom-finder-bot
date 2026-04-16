import { Context, Telegraf } from 'telegraf';

import { Featured } from '../models/Featured';
import { Channel } from '../models/Channel';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { ChannelMessage } from '../models/ChannelMessage';
import { cacheService } from '../services/cache';
import { SearchService } from '../services/search';
import { getSession, setSession, clearSession } from '../services/session';
import { sendSearchResults } from '../commands/search';
import { handleBroadcastPreview } from '../commands/broadcast';
import { buildCategoryKeyboard } from '../utils/keyboards';
import { escapeMarkdown } from '../utils/helpers';
import { logger } from '../utils/logger';
import { isAdmin } from '../middleware/admin';

export function registerTextHandler(bot: Telegraf, searchService: SearchService): void {
  bot.on('text', async (ctx) => {
    const text = ctx.message.text.trim();
    const userId = ctx.from.id;

    // Handle /cancel globally
    if (text === '/cancel') {
      clearSession(userId);
      await ctx.reply('❌ Operation cancelled.');
      return;
    }

    const session = getSession(userId);

    switch (session.step) {
      case 'search_query': {
        if (text.startsWith('/')) break; // Don't intercept commands
        if (text.length < 2) {
          await ctx.reply('⚠️ Please enter at least 2 characters for the ROM name.');
          return;
        }
        if (text.length > 100) {
          await ctx.reply('⚠️ Search query is too long. Please use a shorter name.');
          return;
        }
        await sendSearchResults(ctx, searchService, text, session.category);
        return;
      }

      case 'broadcast_compose': {
        if (!isAdmin(userId)) break;
        if (text.startsWith('/')) break;
        await handleBroadcastPreview(ctx, text);
        return;
      }

      case 'set_request_url': {
        if (!isAdmin(userId)) break;
        if (!text.startsWith('http')) {
          await ctx.reply('⚠️ Please provide a valid URL starting with http:// or https://');
          return;
        }
        await Setting.findOneAndUpdate(
          { key: SETTING_KEYS.REQUEST_URL },
          { $set: { value: text, updatedBy: userId } },
          { upsert: true }
        );
        clearSession(userId);
        await ctx.reply(`✅ Request\\-It URL updated to:\n${escapeMarkdown(text)}`, {
          parse_mode: 'MarkdownV2',
        });
        return;
      }

      case 'set_featured_pick_msg': {
        if (!isAdmin(userId)) break;
        // Expect forwarded message OR message link OR "title|channelId|messageId"
        await handleFeaturedInput(ctx, session.position, text);
        return;
      }

      default:
        // Not in a flow — do nothing, let command handlers take over
        break;
    }
  });

  // Handle forwarded messages for featured ROM selection
  bot.on('message', async (ctx) => {
    const msg = ctx.message as any;
    const userId = ctx.from?.id;
    if (!userId) return;

    const session = getSession(userId);
    if (session.step !== 'set_featured_pick_msg') return;
    if (!isAdmin(userId)) return;

    // Check if this is a forwarded channel message
    const forwardOrigin = (msg as any).forward_origin;
    const forwardFromChat = (msg as any).forward_from_chat;

    const channelId =
      forwardFromChat?.id?.toString() ||
      forwardOrigin?.chat?.id?.toString();

    const messageId =
      (msg as any).forward_from_message_id ||
      forwardOrigin?.message_id;

    if (!channelId || !messageId) {
      await ctx.reply(
        '⚠️ Could not extract channel info from this message\\.\n\n' +
        'Please forward a message directly from a tracked channel, or send in format:\n' +
        '`Title | channelId | messageId`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    // Extract title from caption or document name
    const caption: string = (msg as any).caption || '';
    const docName: string = (msg as any).document?.file_name || '';
    const title = docName || caption.split('\n')[0] || `ROM #${messageId}`;

    await saveFeatured(ctx, session.position, title, channelId, messageId, userId);
  });
}

async function handleFeaturedInput(
  ctx: Context,
  position: number,
  text: string
): Promise<void> {
  const userId = ctx.from!.id;

  // Support manual format: "Title | -1001234567890 | 12345"
  const parts = text.split('|').map((s) => s.trim());
  if (parts.length === 3) {
    const [title, channelId, msgIdStr] = parts;
    const messageId = parseInt(msgIdStr, 10);

    if (!title || !channelId.startsWith('-100') || isNaN(messageId)) {
      await ctx.reply(
        '⚠️ Invalid format\\. Use: `Title | \\-100xxxxxxxxxx | messageId`',
        { parse_mode: 'MarkdownV2' }
      );
      return;
    }

    await saveFeatured(ctx, position, title, channelId, messageId, userId);
    return;
  }

  await ctx.reply(
    '⚠️ Please forward a message from a tracked channel, or send:\n' +
    '`Title | channelId | messageId`',
    { parse_mode: 'MarkdownV2' }
  );
}

async function saveFeatured(
  ctx: Context,
  position: number,
  title: string,
  channelId: string,
  messageId: number,
  userId: number
): Promise<void> {
  // Detect category from channel mapping
  const channelMapping = await Channel.findOne({ channelId }, 'category').lean();

  await Featured.findOneAndUpdate(
    { position },
    {
      $set: {
        title: title.slice(0, 100),
        channelId,
        messageId,
        category: channelMapping?.category,
        addedBy: userId,
      },
    },
    { upsert: true }
  );

  clearSession(userId);
  logger.info(`Featured position #${position} set by admin ${userId}: "${title}"`);

  await ctx.reply(
    `✅ *Featured \\#${position} updated\\!*\n\n` +
    `Title: *${escapeMarkdown(title)}*\n` +
    `Channel: \`${escapeMarkdown(channelId)}\`\n` +
    `Message ID: ${messageId}`,
    { parse_mode: 'MarkdownV2' }
  );
}
