import { Context, Telegraf } from 'telegraf';
import { CallbackQuery } from 'telegraf/typings/core/types/typegram';
import { Channel } from '../models/Channel';
import { Featured } from '../models/Featured';
import { ChannelMessage } from '../models/ChannelMessage';
import { Search } from '../models/Search';
import { User } from '../models/User';
import { SearchFeedback } from '../models/SearchFeedback';
import { cacheService } from '../services/cache';
import { SearchService } from '../services/search';
import { getSession, setSession, clearSession } from '../services/session';
import {
  buildConfirmKeyboard,
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
import { executeBroadcast, handleBroadcastPreview } from '../commands/broadcast';
import { runBackfill } from '../commands/backfill';
import { setMaintenance } from '../commands/maintenance';
import {
  handleUnindexTagPrompt,
  handleUnindexForwardPrompt,
  handleUnindexList,
  handleRemoveBlockedTag,
} from '../commands/unindex';
import { sendSearchResults } from '../commands/search';
import { parseCallbackData, escapeMarkdown, normalizeQuery } from '../utils/helpers';
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

        // About: Source Code popup
        case 'about_source': {
          await ctx.answerCbQuery();
          await ctx.reply(
            `📦 <b>Source Code</b>\n\n` +
            `<a href="${config.SOURCE_CODE_URL}">GitHub → ROM Finder Bot</a>\n\n` +
            `This bot can be used for any general file search, not just ROMs!\n` +
            `⭐ Star and fork the repo, then replace the word <b>"ROM"</b> ` +
            `with whatever you need — books, music, mods, patches, anything.`,
            {
              parse_mode: 'HTML',
              link_preview_options: { is_disabled: true },
            }
          );
          break;
        }

        // ── Search flow ──────────────────────────────────────────────────
        case 'search_cat': {
          if (payload === 'ALL') {
            setSession(userId, { step: 'search_query', category: undefined, categoryLabel: undefined });
            await ctx.answerCbQuery('Searching all channels');
            await ctx.editMessageText(
              `🔍 *Searching all channels*\n\nType the ROM name you\'re looking for:`,
              { parse_mode: 'MarkdownV2' }
            );
          } else {
            const ch = await Channel.findOne({ channelId: payload }, 'channelId label').lean();
            const label    = ch?.label    || payload;
            const category = ch?.channelId || payload;
            setSession(userId, { step: 'search_query', category, categoryLabel: label });
            await ctx.answerCbQuery(`Category: ${label}`);
            await ctx.editMessageText(
              `🔍 Category: *${escapeMarkdown(label)}*\n\nType the ROM name you\'re looking for:`,
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
          await ctx.answerCbQuery('Other matches are shown above ⬆️');
          break;
        }

        // ── Feedback ─────────────────────────────────────────────────────
        case 'feedback': {
          // payload format: yes:channelId:messageId:encodedQuery  OR  no:channelId:...
          const parts = payload.split(':');
          const vote        = parts[0];           // "yes" or "no"
          const channelId   = parts[1];
          const messageId   = parseInt(parts[2], 10);
          const rawQuery    = decodeURIComponent(parts.slice(3).join(':'));
          const normalized  = normalizeQuery(rawQuery);
          const gotIt       = vote === 'yes';

          // Get file name for reference
          const msg = await ChannelMessage.findOne(
            { channelId, messageId },
            'fileName'
          ).lean();

          try {
            await SearchFeedback.findOneAndUpdate(
              { normalizedQuery: normalized, channelId, messageId, userId },
              { $set: { gotIt, fileName: msg?.fileName || 'unknown' } },
              { upsert: true }
            );
          } catch (e: any) {
            // Duplicate key = already voted, just update
            if (e.code !== 11000) throw e;
          }

          // Invalidate cache so next search picks up the boost
          cacheService.invalidate(normalized);

          if (gotIt) {
            await ctx.answerCbQuery('✅ Great! Thanks for the feedback!');
            await ctx.editMessageText(
              '✅ *Glad you found it\\!* Your feedback helps improve results\\.',
              { parse_mode: 'MarkdownV2' }
            );
          } else {
            await ctx.answerCbQuery('Got it. Let\'s try again!');
            await ctx.editMessageText(
              `❌ *Sorry about that\\!*\n\n` +
              `Your feedback is recorded — that result will be ranked lower next time\\.\n\n` +
              `Would you like to search again?`,
              {
                parse_mode: 'MarkdownV2',
                reply_markup: {
                  inline_keyboard: [[
                    { text: '🔄 Search Again', callback_data: 'search_again' },
                  ]],
                },
              }
            );
          }
          break;
        }

        // ── Admin: Settings menu ─────────────────────────────────────────
        case 'admin_set': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          // answerCbQuery ONCE here — handler functions must NOT call it again
          await ctx.answerCbQuery();
          switch (payload) {
            case 'channels':    await handleShowChannelMapping(ctx); break;
            case 'featured':    await handleShowFeatured(ctx);       break;
            case 'request_url': await handleSetRequestUrl(ctx);      break;
            default:
              await ctx.editMessageText('⚠️ Unknown setting.');
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
          const existing  = await Channel.findOne({ channelId }, 'label').lean();
          setSession(userId, { step: 'map_channel_label', channelId });

          let text = `📡 *Mapping channel:*\n\`${escapeMarkdown(channelId)}\`\n\n`;
          if (existing) {
            text += `Current label: *${escapeMarkdown(existing.label)}*\n\n`;
          }
          text +=
            `Send a *short button label* for this channel\\.\n` +
            `It becomes a button in /search\\.\n\n` +
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
            case 'stats': {
              // answerCbQuery ONCE — handleDbStats must NOT call it
              await ctx.answerCbQuery();
              await handleDbStats(ctx);
              break;
            }
            case 'clear_cache': {
              const count = cacheService.invalidate();
              await ctx.answerCbQuery(`✅ Cleared ${count} entries`);
              await ctx.editMessageText(
                `✅ Cache cleared — *${count}* entries removed\\.`,
                { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
              );
              break;
            }
            case 'clear_index': {
              const { searchService: svc } = await import('../index');
              svc.clearIndex();
              cacheService.invalidate();
              await ctx.answerCbQuery('✅ Index cleared');
              await ctx.editMessageText(
                '✅ Message index cleared\\. Will rebuild on next search\\.',
                { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
              );
              break;
            }
            case 'delete_all': {
              await ctx.answerCbQuery();
              await ctx.editMessageText(
                '⚠️ *DANGER ZONE*\n\n' +
                'Permanently deletes:\n' +
                '• All indexed channel messages\n' +
                '• All search records & feedback\n' +
                '• All featured ROMs\n' +
                '• All channel mappings\n' +
                '• All user records\n\n' +
                'This *cannot be undone*\\!',
                { parse_mode: 'MarkdownV2', reply_markup: buildConfirmKeyboard('delete_all_data') }
              );
              break;
            }
          }
          break;
        }

        // ── Confirm actions ──────────────────────────────────────────────
        case 'confirm': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          const firstColon    = payload.indexOf(':');
          const confirmAction = firstColon >= 0 ? payload.slice(0, firstColon) : payload;
          const confirmPayload = firstColon >= 0 ? payload.slice(firstColon + 1) : '';

          switch (confirmAction) {
            case 'delete_all_data': {
              await ctx.answerCbQuery('🗑️ Deleting...');
              await Promise.all([
                ChannelMessage.deleteMany({}),
                Search.deleteMany({}),
                Featured.deleteMany({}),
                Channel.deleteMany({}),
                User.deleteMany({}),
                SearchFeedback.deleteMany({}),
              ]);
              cacheService.invalidate();
              await ctx.editMessageText('✅ All data deleted successfully.');
              break;
            }
            case 'replace_mapping': {
              const sepIdx   = confirmPayload.indexOf('|||');
              const chanId   = confirmPayload.slice(0, sepIdx);
              const newLabel = confirmPayload.slice(sepIdx + 3);
              await Channel.findOneAndUpdate(
                { channelId: chanId },
                { $set: { label: newLabel, category: chanId, mappedBy: userId, mappedAt: new Date() } }
              );
              cacheService.invalidate();
              await ctx.answerCbQuery('✅ Updated');
              clearSession(userId);
              const all     = config.CHANNELS;
              const mapped  = await Channel.find({}).lean();
              await ctx.editMessageText(
                `✅ Channel remapped to *${escapeMarkdown(newLabel)}*\n\nSelect another channel:`,
                {
                  parse_mode: 'MarkdownV2',
                  reply_markup: buildChannelMappingKeyboard(all, mapped as any),
                }
              );
              break;
            }
          }
          break;
        }

        // ── Broadcast format picker ──────────────────────────────────────
        case 'bcast_fmt': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          const session = getSession(userId);
          if (session.step !== 'broadcast_pick_format') {
            await ctx.answerCbQuery('Session expired. Use /broadcast again.');
            return;
          }
          const parseMode = payload as import('../services/session').BroadcastParseMode;
          await handleBroadcastPreview(ctx, session.message, parseMode);
          break;
        }

        // ── Broadcast confirm / reformat ──────────────────────────────────
        case 'broadcast': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          const session = getSession(userId);

          if (payload === 'confirm') {
            if (session.step !== 'broadcast_confirm') {
              await ctx.answerCbQuery('Session expired. Use /broadcast again.');
              return;
            }
            await executeBroadcast(ctx, bot, session.message, session.parseMode);

          } else if (payload === 'reformat') {
            // Go back to format picker with the same message
            if (session.step !== 'broadcast_confirm') {
              await ctx.answerCbQuery('Session expired.');
              return;
            }
            await ctx.answerCbQuery();
            setSession(userId, { step: 'broadcast_pick_format', message: session.message });
            await ctx.reply(
              `🔄 <b>Choose a different format:</b>`,
              {
                parse_mode: 'HTML',
                reply_markup: {
                  inline_keyboard: [
                    [{ text: '📄 Plain Text',              callback_data: 'bcast_fmt:none'     }],
                    [{ text: '🏷️ HTML (<b>, <i>, <a>)',    callback_data: 'bcast_fmt:HTML'     }],
                    [{ text: '✏️ Markdown (*bold*, _italic_)', callback_data: 'bcast_fmt:Markdown' }],
                    [{ text: '❌ Cancel',                    callback_data: 'admin_cancel'       }],
                  ],
                },
              }
            );
          }
          break;
        }

        // ── Maintenance ─────────────────────────────────────────────────
        case 'maintenance': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          if (payload === 'on' || payload === 'off') {
            await setMaintenance(ctx, payload as 'on' | 'off');
          }
          break;
        }

        // ── Unindex ──────────────────────────────────────────────────────
        case 'unindex': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          switch (payload) {
            case 'tag':     await handleUnindexTagPrompt(ctx);     break;
            case 'forward': await handleUnindexForwardPrompt(ctx); break;
            case 'list':    await handleUnindexList(ctx);          break;
            case 'back': {
              await ctx.answerCbQuery();
              const { unindexCommand } = await import('../commands/unindex');
              // Re-show the main unindex menu
              await ctx.deleteMessage().catch(() => {});
              await unindexCommand(ctx);
              break;
            }
          }
          break;
        }

        case 'unindex_remove_tag': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          await handleRemoveBlockedTag(ctx, payload);
          break;
        }

        // ── Backfill ─────────────────────────────────────────────────────
        case 'backfill_start': {
          if (!isAdmin(userId)) { await ctx.answerCbQuery('⛔ Admins only'); return; }
          await ctx.answerCbQuery('🔄 Starting backfill...');
          await ctx.deleteMessage().catch(() => {});
          await runBackfill(ctx, bot, payload);
          break;
        }

        default:
          await ctx.answerCbQuery();
          logger.debug(`Unhandled callback: ${cq.data}`);
      }
    } catch (error) {
      logger.error(`Callback error action="${action}":`, error);
      await ctx.answerCbQuery('❌ Something went wrong. Please try again.').catch(() => {});
    }
  });
}
