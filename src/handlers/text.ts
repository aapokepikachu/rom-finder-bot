import { Context, Telegraf } from 'telegraf';
import { Message } from 'telegraf/typings/core/types/typegram';
import { Featured } from '../models/Featured';
import { Channel } from '../models/Channel';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { SearchService } from '../services/search';
import { getSession, setSession, clearSession } from '../services/session';
import { sendSearchResults } from '../commands/search';
import { handleBroadcastPreview } from '../commands/broadcast';
import {
  buildChannelMappingKeyboard,
  buildConfirmKeyboard,
} from '../utils/keyboards';
import { logger } from '../utils/logger';
import { isAdmin } from '../middleware/admin';
import { config } from '../config';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function registerTextHandler(bot: Telegraf, searchService: SearchService): void {

  bot.on('text', async (ctx) => {
    const text   = ctx.message.text.trim();
    const userId = ctx.from.id;

    if (text === '/cancel') {
      clearSession(userId);
      await ctx.reply('❌ Operation cancelled.');
      return;
    }

    const session = getSession(userId);

    switch (session.step) {

      // ── Search: ROM name entry ─────────────────────────────────────────
      case 'search_query': {
        if (text.startsWith('/')) break;
        if (text.length < 2) {
          await ctx.reply('⚠️ Please enter at least 2 characters.');
          return;
        }
        if (text.length > 100) {
          await ctx.reply('⚠️ Search query is too long. Please shorten it.');
          return;
        }
        await sendSearchResults(ctx, searchService, text, session.category, session.categoryLabel);
        return;
      }

      // ── Admin: channel label entry ─────────────────────────────────────
      case 'map_channel_label': {
        if (!isAdmin(userId)) break;
        if (text.startsWith('/')) break;

        const label = text.trim();
        if (label.length < 1 || label.length > 50) {
          await ctx.reply('⚠️ Label must be 1–50 characters. Try again:');
          return;
        }

        const { channelId } = session;
        const existing = await Channel.findOne({ channelId }, 'label').lean();

        if (existing) {
          setSession(userId, { step: 'idle' });
          await ctx.reply(
            `⚠️ Channel already mapped as <b>${esc(existing.label)}</b>\n\n` +
            `Replace with <b>${esc(label)}</b>?`,
            {
              parse_mode: 'HTML',
              reply_markup: buildConfirmKeyboard('replace_mapping', `${channelId}|||${label}`),
            }
          );
        } else {
          await Channel.create({
            channelId,
            category: channelId,
            label,
            mappedBy: userId,
            mappedAt: new Date(),
          });
          cacheService.invalidate();
          clearSession(userId);

          logger.info(`Admin ${userId} mapped ${channelId} → "${label}"`);

          await ctx.reply(
            `✅ <b>Channel mapped!</b>\n\n` +
            `📡 Channel: <code>${esc(channelId)}</code>\n` +
            `🏷️ Label: <b>${esc(label)}</b>\n\n` +
            `This label appears as a button in /search.`,
            { parse_mode: 'HTML' }
          );

          const allChannels    = config.CHANNELS;
          const mappedChannels = await Channel.find({}).lean();

          await ctx.reply(
            '📡 <b>Channel Mappings</b>\n\nSelect another channel to map, or press Cancel:',
            {
              parse_mode: 'HTML',
              reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels as any),
            }
          );
        }
        return;
      }

      // ── Admin: broadcast compose ───────────────────────────────────────
      case 'broadcast_compose': {
        if (!isAdmin(userId)) break;
        if (text.startsWith('/')) break;
        await handleBroadcastPreview(ctx, text);
        return;
      }

      // ── Admin: set Request-It URL ──────────────────────────────────────
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
        await ctx.reply(
          `✅ <b>Request-It URL updated:</b>\n<code>${esc(text)}</code>`,
          { parse_mode: 'HTML' }
        );
        return;
      }

      // ── Admin: featured ROM text input ─────────────────────────────────
      case 'set_featured_pick_msg': {
        if (!isAdmin(userId)) break;
        await handleFeaturedTextInput(ctx, session.position, text, userId);
        return;
      }

      default:
        break;
    }
  });

  // ── Forwarded messages for featured ROM selection ──────────────────────
  bot.on('message', async (ctx) => {
    const msg    = ctx.message as any;
    const userId = ctx.from?.id;
    if (!userId || !isAdmin(userId)) return;

    const session = getSession(userId);
    if (session.step !== 'set_featured_pick_msg') return;

    const forwardFromChat  = msg.forward_from_chat;
    const forwardOrigin    = msg.forward_origin;
    const channelId =
      forwardFromChat?.id?.toString() ||
      forwardOrigin?.chat?.id?.toString();
    const messageId =
      msg.forward_from_message_id ||
      forwardOrigin?.message_id;

    if (!channelId || !messageId) return;

    const caption: string = msg.caption || '';
    const docName: string = msg.document?.file_name || '';
    const title           = docName || caption.split('\n')[0] || `ROM #${messageId}`;

    await saveFeatured(ctx, session.position, title, channelId, messageId, userId);
  });
}

async function handleFeaturedTextInput(
  ctx: Context,
  position: number,
  text: string,
  userId: number
): Promise<void> {
  const parts = text.split('|').map((s) => s.trim());
  if (parts.length === 3) {
    const [title, channelId, msgIdStr] = parts;
    const messageId = parseInt(msgIdStr, 10);
    if (!title || !channelId.startsWith('-100') || isNaN(messageId)) {
      await ctx.reply(
        '⚠️ Invalid format. Use:\n<code>Title | -100xxxxxxxxxx | messageId</code>',
        { parse_mode: 'HTML' }
      );
      return;
    }
    await saveFeatured(ctx, position, title, channelId, messageId, userId);
    return;
  }
  await ctx.reply(
    '⚠️ Please forward a message from a ROM channel, or send:\n' +
    '<code>Title | channelId | messageId</code>',
    { parse_mode: 'HTML' }
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
  const mapping = await Channel.findOne({ channelId }, 'label').lean();

  await Featured.findOneAndUpdate(
    { position },
    {
      $set: {
        title:     title.slice(0, 100),
        channelId,
        messageId,
        category:  mapping?.label,
        addedBy:   userId,
      },
    },
    { upsert: true }
  );

  clearSession(userId);
  logger.info(`Featured #${position} set: "${title}"`);

  await ctx.reply(
    `✅ <b>Featured #${position} updated!</b>\n\n` +
    `📁 ${esc(title)}\n` +
    `📡 Channel: <code>${esc(channelId)}</code>\n` +
    `🔢 Message ID: ${messageId}`,
    { parse_mode: 'HTML' }
  );
}
