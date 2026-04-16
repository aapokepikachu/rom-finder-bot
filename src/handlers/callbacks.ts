import { Context, Telegraf } from 'telegraf';
import { CallbackQuery } from 'telegraf/typings/core/types/typegram';
import { Channel } from '../models/Channel';
import { Featured } from '../models/Featured';
import { ChannelMessage } from '../models/ChannelMessage';
import { Search } from '../models/Search';
import { User } from '../models/User';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { SearchService } from '../services/search';
import { getSession, setSession, clearSession } from '../services/session';
import {
  buildCategoryAssignKeyboard,
  buildConfirmKeyboard,
  buildAdminSettingsKeyboard,
  buildDbToolsKeyboard,
  buildChannelMappingKeyboard,
} from '../utils/keyboards';
import {
  handleDbStats,
  handleShowChannelMapping,
  handleShowFeatured,
  handleSetRequestUrl,
} from '../commands/admin';
import { executeBroadcast } from '../commands/broadcast';
import { sendSearchResults } from '../commands/search';
import { parseCallbackData, escapeMarkdown } from '../utils/helpers';
import { config, CATEGORIES } from '../config';
import { logger } from '../utils/logger';
import { isAdmin } from '../middleware/admin';

export function registerCallbackHandlers(bot: Telegraf, searchService: SearchService): void {
  bot.on('callback_query', async (ctx) => {
    const cq = ctx.callbackQuery as CallbackQuery.DataQuery;
    if (!cq?.data) return;

    const { action, payload } = parseCallbackData(cq.data);
    const userId = ctx.from.id;

    try {
      switch (action) {
        // ── Search flow ────────────────────────────────────────────
        case 'search_cat': {
          const category = payload === 'ALL' ? undefined : payload;
          setSession(userId, { step: 'search_query', category });
          await ctx.answerCbQuery(`Category: ${payload}`);
          await ctx.editMessageText(
            `🔍 Category selected: *${escapeMarkdown(payload)}*\n\n` +
            `Now type the ROM name you're looking for:`,
            { parse_mode: 'MarkdownV2' }
          );
          break;
        }

        case 'search_again': {
          await ctx.answerCbQuery();
          clearSession(userId);
          const { searchCommand } = await import('../commands/search');
          await searchCommand(ctx);
          break;
        }

        case 'show_more_results': {
          // Handled inline — other matches are sent separately
          await ctx.answerCbQuery('Other matches shown above ⬆️');
          break;
        }

        // ── Admin: Settings menu ────────────────────────────────────
        case 'admin_set': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }
          await ctx.answerCbQuery();

          switch (payload) {
            case 'channels':
              await handleShowChannelMapping(ctx);
              break;
            case 'featured':
              await handleShowFeatured(ctx);
              break;
            case 'request_url':
              await handleSetRequestUrl(ctx);
              break;
          }
          break;
        }

        case 'admin_cancel': {
          await ctx.answerCbQuery('Cancelled');
          clearSession(userId);
          await ctx.deleteMessage().catch(() => {});
          break;
        }

        // ── Admin: Channel mapping ──────────────────────────────────
        case 'map_channel': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }
          await ctx.answerCbQuery();

          const channelId = payload;
          const existing = await Channel.findOne({ channelId }, 'category').lean();

          let text = `📡 *Channel:* \`${escapeMarkdown(channelId)}\`\n\n`;
          if (existing) {
            text += `Current category: *${existing.category}*\n\n`;
          }
          text += 'Select a category to assign:';

          await ctx.editMessageText(text, {
            parse_mode: 'MarkdownV2',
            reply_markup: buildCategoryAssignKeyboard(channelId),
          });
          break;
        }

        case 'assign_cat': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }

          const parts = payload.split(':');
          const channelId = parts.slice(0, -1).join(':');
          const category = parts[parts.length - 1] as any;

          if (!CATEGORIES.includes(category)) {
            await ctx.answerCbQuery('Invalid category');
            return;
          }

          const existing = await Channel.findOne({ channelId }).lean();
          if (existing) {
            // Ask for confirmation to replace
            await ctx.answerCbQuery();
            await ctx.editMessageText(
              `⚠️ Channel \`${escapeMarkdown(channelId)}\` is already mapped to *${existing.category}*\\.\n\n` +
              `Replace with *${category}*?`,
              {
                parse_mode: 'MarkdownV2',
                reply_markup: buildConfirmKeyboard('replace_cat', `${channelId}:${category}`),
              }
            );
          } else {
            await Channel.create({
              channelId,
              category,
              mappedBy: userId,
              mappedAt: new Date(),
            });
            cacheService.invalidate();
            await ctx.answerCbQuery(`✅ Mapped to ${category}`);

            const allChannels = config.CHANNELS;
            const mappedChannels = await Channel.find({}).lean();
            await ctx.editMessageText(
              `✅ Channel \`${escapeMarkdown(channelId)}\` → *${category}*\n\nSelect another channel to map:`,
              {
                parse_mode: 'MarkdownV2',
                reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels),
              }
            );
          }
          break;
        }

        case 'map_back': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }
          await ctx.answerCbQuery();
          await handleShowChannelMapping(ctx);
          break;
        }

        // ── Admin: Featured ROMs ────────────────────────────────────
        case 'feat_pos': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }
          const position = parseInt(payload, 10);
          setSession(userId, { step: 'set_featured_pick_msg', position });
          await ctx.answerCbQuery(`Position #${position} selected`);
          await ctx.editMessageText(
            `⭐ *Set Featured ROM \\#${position}*\n\n` +
            `Forward a message from a ROM channel to set it as featured at position \\#${position}\\.\n\n` +
            `_Or send /cancel to abort\\._`,
            { parse_mode: 'MarkdownV2' }
          );
          break;
        }

        // ── Admin: DB actions ───────────────────────────────────────
        case 'db': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }

          switch (payload) {
            case 'stats':
              await handleDbStats(ctx);
              break;

            case 'clear_cache': {
              const count = cacheService.invalidate();
              await ctx.answerCbQuery(`✅ Cleared ${count} cached entries`);
              await ctx.editMessageText(
                `✅ Cache cleared\\. ${count} entries removed\\.`,
                { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
              );
              break;
            }

            case 'clear_index': {
              const { searchService: svc } = await import('../index');
              svc.clearIndex();
              cacheService.invalidate();
              await ctx.answerCbQuery('✅ Message index cleared');
              await ctx.editMessageText(
                '✅ Message index cleared\\. It will be rebuilt on next search\\.',
                { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
              );
              break;
            }

            case 'delete_all': {
              await ctx.answerCbQuery();
              await ctx.editMessageText(
                '⚠️ *DANGER ZONE*\n\n' +
                'This will delete ALL data:\n' +
                '• All indexed channel messages\n' +
                '• All search records\n' +
                '• All featured ROMs\n' +
                '• All channel mappings\n' +
                '• All user records\n\n' +
                'This action *cannot be undone*\\!',
                {
                  parse_mode: 'MarkdownV2',
                  reply_markup: buildConfirmKeyboard('delete_all_data'),
                }
              );
              break;
            }
          }
          break;
        }

        // ── Confirm actions ─────────────────────────────────────────
        case 'confirm': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }

          const [confirmAction, ...confirmPayloadParts] = payload.split(':');
          const confirmPayload = confirmPayloadParts.join(':');

          switch (confirmAction) {
            case 'delete_all_data': {
              await ctx.answerCbQuery('🗑️ Deleting all data...');
              await Promise.all([
                ChannelMessage.deleteMany({}),
                Search.deleteMany({}),
                Featured.deleteMany({}),
                Channel.deleteMany({}),
                User.deleteMany({}),
              ]);
              cacheService.invalidate();
              await ctx.editMessageText('✅ All data deleted successfully.');
              break;
            }

            case 'replace_cat': {
              const catParts = confirmPayload.split(':');
              const newCategory = catParts[catParts.length - 1] as any;
              const chanId = catParts.slice(0, -1).join(':');

              await Channel.findOneAndUpdate(
                { channelId: chanId },
                { $set: { category: newCategory, mappedBy: userId, mappedAt: new Date() } }
              );
              cacheService.invalidate();
              await ctx.answerCbQuery(`✅ Updated to ${newCategory}`);

              const allChannels = config.CHANNELS;
              const mappedChannels = await Channel.find({}).lean();
              await ctx.editMessageText(
                `✅ Channel mapping updated\\.\n\nSelect another channel:`,
                {
                  parse_mode: 'MarkdownV2',
                  reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels),
                }
              );
              break;
            }
          }
          break;
        }

        // ── Broadcast ───────────────────────────────────────────────
        case 'broadcast': {
          if (!isAdmin(userId)) {
            await ctx.answerCbQuery('⛔ Admins only');
            return;
          }

          if (payload === 'confirm') {
            const session = getSession(userId);
            if (session.step !== 'broadcast_confirm') {
              await ctx.answerCbQuery('Session expired. Please /broadcast again.');
              return;
            }
            await executeBroadcast(ctx, bot, session.message);
          }
          break;
        }

        default:
          await ctx.answerCbQuery();
          logger.debug(`Unhandled callback: ${cq.data}`);
      }
    } catch (error) {
      logger.error(`Callback handler error for action="${action}":`, error);
      await ctx.answerCbQuery('❌ An error occurred. Please try again.').catch(() => {});
    }
  });
}
