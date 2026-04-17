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
  buildConfirmKeyboard,
  buildAdminSettingsKeyboard,
  buildDbToolsKeyboard,
  buildChannelMappingKeyboard,
  buildFeaturedPositionKeyboard,
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
import { config } from '../config';
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

        // ── Search flow ──────────────────────────────────────────────────
        case 'search_cat': {
          if (payload === 'ALL') {
            setSession(userId, { step: 'search_query', category: undefined, categoryLabel: undefined });
            await ctx.answerCbQuery('Searching all categories');
            await ctx.editMessageText(
              `🔍 *Searching all categories*\n\nType the ROM name you're looking for:`,
              { parse_mode: 'MarkdownV2' }
            );
          } else {
            // payload is a channelId — look up its label
            const ch = await Channel.findOne({ channelId: payload }, 'category label').lean();
            const label = ch?.label || payload;
            const category = ch?.channelId || payload;
            setSession(userId, { step: 'search_query', category, categoryLabel: label });
            await ctx.answerCbQuery(`Category: ${label}`);
            await ctx.editMessageText(
              `🔍 Category: *${escapeMarkdown(label)}*\n\nType the ROM name you're looking for:`,
              { parse_mode: 'MarkdownV2' }
            );
          }
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
          await ctx.answerCbQuery('Scroll up to see other matches ⬆️');
          break;
        }

        // ── Admin: Settings menu ─────────────────────────────────────────
        case 'admin_set': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          await ctx.answerCbQuery();
          switch (payload) {
            case 'channels':     await handleShowChannelMapping(ctx); break;
            case 'featured':     await handleShowFeatured(ctx);       break;
            case 'request_url':  await handleSetRequestUrl(ctx);      break;
          }
          break;
        }

        case 'admin_cancel': {
          await ctx.answerCbQuery('Cancelled');
          clearSession(userId);
          await ctx.deleteMessage().catch(() => {});
          break;
        }

        // ── Admin: Channel mapping ───────────────────────────────────────
        case 'map_channel': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          await ctx.answerCbQuery();

          const channelId = payload;
          const existing = await Channel.findOne({ channelId }, 'category label').lean();

          // Set session so the next text message is the label
          setSession(userId, { step: 'map_channel_label', channelId });

          let text = `📡 *Mapping channel:*\n\`${escapeMarkdown(channelId)}\`\n\n`;
          if (existing) {
            text += `Current label: *${escapeMarkdown(existing.label)}* \\(${escapeMarkdown(existing.category)}\\)\n\n`;
          }
          text +=
            `Please send a *short button label* for this channel\\.\n` +
            `This will appear as a button when users do /search\\.\n\n` +
            `Examples: \`🎮 NDS Roms\`, \`GBA Hacks\`, \`Pokemon NDS\`\n\n` +
            `_Send /cancel to abort\\._`;

          await ctx.editMessageText(text, { parse_mode: 'MarkdownV2' });
          break;
        }

        case 'map_back': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          await ctx.answerCbQuery();
          clearSession(userId);
          await handleShowChannelMapping(ctx);
          break;
        }

        // ── Admin: Featured ROMs ─────────────────────────────────────────
        case 'feat_pos': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          const position = parseInt(payload, 10);
          setSession(userId, { step: 'set_featured_pick_msg', position });
          await ctx.answerCbQuery(`Position #${position} selected`);
          await ctx.editMessageText(
            `⭐ *Set Featured ROM \\#${position}*\n\n` +
            `Forward a file message from a ROM channel, or send:\n` +
            `\`Title | \\-100xxxxxxxxxx | messageId\`\n\n` +
            `_Send /cancel to abort\\._`,
            { parse_mode: 'MarkdownV2' }
          );
          break;
        }

        // ── Admin: DB actions ────────────────────────────────────────────
        case 'db': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }

          switch (payload) {
            case 'stats':
              await handleDbStats(ctx);
              break;

            case 'clear_cache': {
              const count = cacheService.invalidate();
              await ctx.answerCbQuery(`✅ Cleared ${count} cached entries`);
              await ctx.editMessageText(
                `✅ Cache cleared\\. *${count}* entries removed\\.`,
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
                '✅ Message index cleared\\. Rebuilt automatically on next search\\.',
                { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
              );
              break;
            }

            case 'delete_all': {
              await ctx.answerCbQuery();
              await ctx.editMessageText(
                '⚠️ *DANGER ZONE*\n\n' +
                'This will permanently delete:\n' +
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

        // ── Confirm actions ──────────────────────────────────────────────
        case 'confirm': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }

          const [confirmAction, ...rest] = payload.split(':');
          const confirmPayload = rest.join(':');

          switch (confirmAction) {
            case 'delete_all_data': {
              await ctx.answerCbQuery('🗑️ Deleting...');
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

            case 'replace_mapping': {
              // payload: channelId|||label  (using ||| as separator to avoid conflicts)
              const sepIdx = confirmPayload.indexOf('|||');
              const chanId = confirmPayload.slice(0, sepIdx);
              const newLabel = confirmPayload.slice(sepIdx + 3);
              await Channel.findOneAndUpdate(
                { channelId: chanId },
                { $set: { label: newLabel, category: chanId, mappedBy: userId, mappedAt: new Date() } }
              );
              cacheService.invalidate();
              await ctx.answerCbQuery(`✅ Updated`);
              clearSession(userId);
              const allChannels = config.CHANNELS;
              const mappedChannels = await Channel.find({}).lean();
              await ctx.editMessageText(
                `✅ Channel remapped to *${escapeMarkdown(newLabel)}*\n\nSelect another channel to map:`,
                {
                  parse_mode: 'MarkdownV2',
                  reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels as any),
                }
              );
              break;
            }
          }
          break;
        }

        // ── Broadcast ────────────────────────────────────────────────────
        case 'broadcast': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
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
      logger.error(`Callback error action="${action}" payload="${payload}":`, error);
      await ctx.answerCbQuery('❌ Something went wrong. Please try again.').catch(() => {});
    }
  });
}
