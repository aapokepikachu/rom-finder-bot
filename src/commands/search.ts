import { Context } from 'telegraf';
import { SearchService } from '../services/search';
import { setSession, clearSession } from '../services/session';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { Channel } from '../models/Channel';
import { TagCategory } from '../models/TagCategory';
import {
  buildSearchCategoryKeyboard,
  buildResultKeyboard,
  buildRequestItKeyboard,
  buildFeedbackKeyboard,
  buildNoResultsKeyboard,
} from '../utils/keyboards';
import {
  escapeMarkdown,
  truncate,
  formatFileSize,
  buildMessageLink,
  cleanDisplayName,
  parseFileTags,
} from '../utils/helpers';
import { SearchResult } from '../services/cache';
import { TAG_CATEGORY_PREFIX, isTagCategory } from '../services/search';

// ── Vague query detection ──────────────────────────────────────────────────

/**
 * Returns true if the query is likely too vague to be useful.
 * A single common word with no platform/version hint counts as vague.
 */
export function isVagueQuery(query: string): boolean {
  const normalized = query.trim().toLowerCase();
  // Must be a single token (no spaces = no qualifier added)
  if (normalized.includes(' ')) return false;
  // Short words are usually part of a longer typed query — only flag medium+ words
  if (normalized.length < 4) return false;
  return true;
}

const VAGUE_HINT_DEFAULT =
  `💡 <b>Be more specific for better results!</b>\n\n` +
  `A single word like <code>{query}</code> can match hundreds of files.\n\n` +
  `Try adding more details, for example:\n` +
  `• <code>{query} GBA</code>\n` +
  `• <code>{query} Fire Red</code>\n` +
  `• <code>{query} NDS ROM</code>\n\n` +
  `The more specific you are, the better the match! 🎯\n\n` +
  `<i>Send a more specific name, or tap below to search anyway:</i>`;

export async function checkVagueAndReply(
  ctx: Context,
  query: string,
): Promise<boolean> {
  if (!isVagueQuery(query)) return false;

  // Check if admin has set a custom hint message
  const setting = await Setting.findOne({ key: SETTING_KEYS.VAGUE_SEARCH_HINT }).lean();
  const template = setting?.value || VAGUE_HINT_DEFAULT;
  const message  = template.replace(/\{query\}/g, esc(query));

  await ctx.reply(message, {
    parse_mode: 'HTML',
    reply_markup: {
      inline_keyboard: [[
        { text: `🔍 Search "${query}" anyway`, callback_data: `search_vague:${encodeURIComponent(query)}` },
        { text: '✏️ Change query',             callback_data: 'search_vague_cancel' },
      ]],
    },
  });

  return true;
}

export async function searchCommand(ctx: Context): Promise<void> {
  const [channelCategories, tagCategories] = await Promise.all([
    Channel.find({}).sort({ label: 1 }).lean(),
    TagCategory.find({}).sort({ label: 1 }).lean(),
  ]);

  const hasAny = channelCategories.length > 0 || tagCategories.length > 0;

  setSession(ctx.from!.id, { step: 'search_category' });

  if (!hasAny) {
    setSession(ctx.from!.id, { step: 'search_query', category: undefined });
    await ctx.reply(
      '🔍 <b>ROM Search</b>\n\n<i>No categories mapped yet — searching all channels.</i>\n\nType the ROM name you\'re looking for:',
      { parse_mode: 'HTML' }
    );
    return;
  }

  await ctx.reply(
    '🔍 <b>ROM Search</b>\n\nSelect a category, or search everywhere:',
    {
      parse_mode: 'HTML',
      reply_markup: buildSearchCategoryKeyboard(
        channelCategories as any,
        tagCategories     as any
      ),
    }
  );
}

export function buildBestMatchMessage(result: SearchResult): string {
  const lines: string[] = [];
  const displayName = cleanDisplayName(result.fileName);
  const fileTags    = parseFileTags(result.fileName);

  lines.push(`🎮 <b>Best Match Found!</b>\n`);
  lines.push(`📁 <b>${esc(truncate(displayName, 60))}</b>`);

  // Show region/version badges if any were parsed
  if (fileTags.length > 0) {
    lines.push(`🔖 ${fileTags.map((t) => `<code>${esc(t)}</code>`).join('  ')}`);
  }

  if (result.category) lines.push(`🏷️ Category: <b>${esc(result.category)}</b>`);
  if (result.fileSize) lines.push(`💾 Size: ${esc(formatFileSize(result.fileSize))}`);

  // Show caption but strip @handles and channel links — they clutter the preview
  const cleanCaption = result.caption
    .replace(/@[A-Za-z0-9_]+/g, '')          // remove @handles
    .replace(/https?:\/\/\S+/g, '')        // remove raw URLs
    .replace(/\n{3,}/g, '\n\n')            // collapse excess newlines
    .trim();
  const captionPreview = truncate(cleanCaption, 200);
  if (captionPreview) {
    lines.push(`\n📝 <b>Caption:</b>\n${esc(captionPreview)}`);
  }

  lines.push(`\n🔗 <a href="${result.messageLink}">Open in Channel</a>`);
  return lines.join('\n');
}

/** Returns a human-readable quality label instead of a raw percentage */
function scoreLabel(score: number): string {
  if (score >= 0.80) return '🟢 Great match';
  if (score >= 0.60) return '🟡 Good match';
  if (score >= 0.40) return '🟠 Possible match';
  return '🔴 Weak match';
}

export function buildOtherMatchesMessage(results: SearchResult[]): string {
  if (results.length === 0) return '';

  // Only show results with at least a weak signal — hide very low scores
  const filtered = results.filter((r) => r.score >= 0.05);
  if (filtered.length === 0) return '';

  let text = `\n📋 <b>Other Matches (${filtered.length}):</b>\n\n`;
  filtered.forEach((r, i) => {
    const display = cleanDisplayName(r.fileName);
    const name    = esc(truncate(display, 50));
    const link    = buildMessageLink(r.channelId, r.messageId);
    const label   = scoreLabel(r.score);
    text += `${i + 1}. <a href="${link}">${name}</a>\n    ${label}\n`;
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

  const loadingMsg = await ctx.reply('🔍 Searching... please wait');

  try {
    const response = await searchService.search({
      query,
      category,
      categoryLabel,
      userId,
    });
    await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});

    const requestSetting = await Setting.findOne({ key: SETTING_KEYS.REQUEST_URL }).lean();
    const requestUrl     = requestSetting?.value;

    if (!response.bestMatch) {
      let text = `❌ <b>No Results Found</b>\n\nNo ROMs matched: <b>${esc(query)}</b>\n`;
      if (categoryLabel) text += `Category: <b>${esc(categoryLabel)}</b>\n`;

      // "Did you mean X?" suggestions from loose fuzzy pass
      if (response.didYouMean.length > 0) {
        text += `\n🤔 <b>Did you mean one of these?</b>\n`;
        response.didYouMean.forEach((name) => {
          text += `• <code>${esc(name)}</code>\n`;
        });
        text += `\n<i>Try searching with one of those names above.</i>\n`;
      } else if (response.suggestions.length > 0) {
        text += `\n💡 <b>Suggestions:</b>\n`;
        response.suggestions.forEach((s) => { text += `• ${esc(s)}\n`; });
      }

      // Offer to try a different category if one was selected
      const keyboard = buildNoResultsKeyboard(requestUrl, !!category);
      await ctx.reply(text, {
        parse_mode:   'HTML',
        reply_markup: keyboard,
      });
      clearSession(userId);
      return;
    }

    // Best match
    await ctx.reply(buildBestMatchMessage(response.bestMatch), {
      parse_mode:          'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup:         buildResultKeyboard(response.bestMatch, response.otherMatches, requestUrl),
    });

    // Other matches
    if (response.otherMatches.length > 0) {
      await ctx.reply(buildOtherMatchesMessage(response.otherMatches), {
        parse_mode:          'HTML',
        link_preview_options: { is_disabled: true },
      });
    }

    // Store feedback context in session — callback_data has a 64-byte Telegram limit
    // so we only pass "yes" or "no" in the button; the rest is retrieved from session.
    const best = response.bestMatch;
    const { normalizeQuery } = await import('../utils/helpers');
    setSession(userId, {
      step:            'feedback_pending',
      channelId:       best.channelId,
      messageId:       best.messageId,
      normalizedQuery: normalizeQuery(query),
      category:        category || 'ALL',
      categoryLabel:   categoryLabel || 'All',
    });

    // If this category has a high miss rate, nudge the user
    let feedbackText =
      '❓ <b>Did you find the ROM you were looking for?</b>\n' +
      '<i>Your feedback improves future results.</i>';
    if (response.categoryMissRate >= 0.6 && category && category !== 'ALL') {
      feedbackText +=
        `\n\n💡 <i>Tip: Many users searching in <b>${esc(categoryLabel || category)}</b> ` +
        `don't find what they need here. Try <b>Search All</b> for broader results!</i>`;
    }

    await ctx.reply(feedbackText, {
      parse_mode:   'HTML',
      reply_markup: buildFeedbackKeyboard('pending'),
    });
    // Note: session stays as feedback_pending — cleared after vote or next search
  } catch (error) {
    await ctx.telegram.deleteMessage(ctx.chat!.id, loadingMsg.message_id).catch(() => {});
    throw error;
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
