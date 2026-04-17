import { Context } from 'telegraf';
import { SearchService } from '../services/search';
import { setSession, clearSession } from '../services/session';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { Channel } from '../models/Channel';
import {
  buildSearchCategoryKeyboard,
  buildResultKeyboard,
  buildRequestItKeyboard,
  buildFeedbackKeyboard,
} from '../utils/keyboards';
import {
  escapeMarkdown,
  truncate,
  formatFileSize,
  buildMessageLink,
} from '../utils/helpers';
import { SearchResult } from '../services/cache';

export async function searchCommand(ctx: Context): Promise<void> {
  const mappedChannels = await Channel.find({}).sort({ label: 1 }).lean();

  setSession(ctx.from!.id, { step: 'search_category' });

  if (mappedChannels.length === 0) {
    // No categories mapped — skip straight to query input
    setSession(ctx.from!.id, { step: 'search_query', category: undefined });
    await ctx.reply(
      '🔍 *ROM Search*\n\n_No categories mapped yet — searching all channels\\._\n\nType the ROM name you\'re looking for:',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  await ctx.reply(
    '🔍 *ROM Search*\n\nSelect a category, or search everywhere:',
    {
      parse_mode: 'MarkdownV2',
      reply_markup: buildSearchCategoryKeyboard(mappedChannels as any),
    }
  );
}

export function buildBestMatchMessage(result: SearchResult): string {
  const lines: string[] = [];
  lines.push(`🎮 *Best Match Found\\!*\n`);
  lines.push(`📁 *${escapeMarkdown(truncate(result.fileName, 60))}*`);
  if (result.category) lines.push(`🏷️ Category: *${escapeMarkdown(result.category)}*`);
  if (result.fileSize) lines.push(`💾 Size: ${escapeMarkdown(formatFileSize(result.fileSize))}`);

  const captionPreview = truncate(result.caption.replace(/\n{3,}/g, '\n\n'), 300);
  if (captionPreview) {
    lines.push(`\n📝 *Caption:*\n${escapeMarkdown(captionPreview)}`);
  }
  lines.push(`\n🔗 [Open in Channel](${result.messageLink})`);
  return lines.join('\n');
}

export function buildOtherMatchesMessage(results: SearchResult[]): string {
  if (results.length === 0) return '';
  let text = `\n📋 *Other Matches \\(${results.length}\\):*\n\n`;
  results.forEach((r, i) => {
    const name  = escapeMarkdown(truncate(r.fileName, 50));
    const link  = buildMessageLink(r.channelId, r.messageId);
    const score = Math.round(r.score * 100);
    text += `${i + 1}\\. [${name}](${link}) — ${score}% match\n`;
  });
  return text;
}

export async function sendSearchResults(
  ctx: Context,
  searchService: SearchService,
  query: string,
  category?: string,
  categoryLabel?: string
): Promise<void> {
  const userId = ctx.from!.id;

  const loadingMsg = await ctx.reply('🔍 Searching\\.\\.\\. please wait', {
    parse_mode: 'MarkdownV2',
  });

  try {
    const response = await searchService.search({ query, category, userId });
    await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    const requestSetting = await Setting.findOne({ key: SETTING_KEYS.REQUEST_URL }).lean();
    const requestUrl = requestSetting?.value;

    if (!response.bestMatch) {
      let text = `❌ *No Results Found*\n\nNo ROMs matched: *${escapeMarkdown(query)}*\n`;
      if (categoryLabel) text += `Category: *${escapeMarkdown(categoryLabel)}*\n`;
      if (response.suggestions.length > 0) {
        text += `\n💡 *Suggestions:*\n`;
        response.suggestions.forEach((s) => { text += `• ${escapeMarkdown(s)}\n`; });
      }
      await ctx.reply(text, {
        parse_mode: 'MarkdownV2',
        reply_markup: buildRequestItKeyboard(requestUrl),
      });
      clearSession(userId);
      return;
    }

    // Best match message
    const bestText = buildBestMatchMessage(response.bestMatch);
    await ctx.reply(bestText, {
      parse_mode: 'MarkdownV2',
      link_preview_options: { is_disabled: true },
      reply_markup: buildResultKeyboard(response.bestMatch, response.otherMatches, requestUrl),
    });

    // Other matches
    if (response.otherMatches.length > 0) {
      await ctx.reply(buildOtherMatchesMessage(response.otherMatches), {
        parse_mode: 'MarkdownV2',
        link_preview_options: { is_disabled: true },
      });
    }

    // Feedback button — ask if this was the right ROM
    const best = response.bestMatch;
    const feedbackPayload = `${best.channelId}:${best.messageId}:${encodeURIComponent(query)}`;
    await ctx.reply(
      '❓ *Did you find the ROM you were looking for?*\n_Your feedback helps improve future results\\._',
      {
        parse_mode: 'MarkdownV2',
        reply_markup: buildFeedbackKeyboard(feedbackPayload),
      }
    );

    clearSession(userId);
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    throw error;
  }
}
