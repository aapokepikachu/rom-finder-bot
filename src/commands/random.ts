import { Context } from 'telegraf';
import { ChannelMessage } from '../models/ChannelMessage';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { Channel } from '../models/Channel';
import { config } from '../config';
import { buildMessageLink, formatFileSize, truncate } from '../utils/helpers';
import { logger } from '../utils/logger';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── Helpers ────────────────────────────────────────────────────────────────

async function getRandomExcludedTags(): Promise<string[]> {
  const s = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS }).lean();
  if (!s?.value) return [];
  return s.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean);
}

async function getRandomExcludedIds(): Promise<Set<string>> {
  const s = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_IDS }).lean();
  if (!s?.value) return new Set();
  return new Set(s.value.split(',').map((t) => t.trim()).filter(Boolean));
}

// ── /random command ────────────────────────────────────────────────────────

export async function randomCommand(ctx: Context): Promise<void> {
  try {
    // Build exclusion filter
    const [excludedTags, excludedIds] = await Promise.all([
      getRandomExcludedTags(),
      getRandomExcludedIds(),
    ]);

    // Build caption exclusion regex — reject docs whose caption contains any excluded tag
    const captionFilter: any =
      excludedTags.length > 0
        ? { caption: { $not: new RegExp(excludedTags.map((t) => escapeRegex(t)).join('|'), 'i') } }
        : {};

    // Count eligible documents (honours exclusions)
    const total = await ChannelMessage.countDocuments(captionFilter);

    if (total === 0) {
      await ctx.reply(
        '😅 <b>No ROMs available for random pick.</b>\n\nThe index is empty — ask an admin to run /backfill!',
        { parse_mode: 'HTML' }
      );
      return;
    }

    // Pick a random offset — keep trying until we land on one not in excludedIds
    // (excludedIds set is typically tiny so this loop exits in 1–2 iterations)
    let doc: any = null;
    let attempts = 0;
    const MAX_ATTEMPTS = 20;

    while (attempts < MAX_ATTEMPTS) {
      const skip = Math.floor(Math.random() * total);
      const candidate = await ChannelMessage.findOne(captionFilter)
        .skip(skip)
        .select('channelId messageId fileName caption category fileSize')
        .lean();

      if (!candidate) break;

      const key = `${candidate.channelId}:${candidate.messageId}`;
      if (!excludedIds.has(key)) {
        doc = candidate;
        break;
      }
      attempts++;
    }

    if (!doc) {
      await ctx.reply(
        '😅 <b>Could not find a random ROM right now.</b>\n\nPlease try again!',
        { parse_mode: 'HTML' }
      );
      return;
    }

    const link = buildMessageLink(doc.channelId, doc.messageId);
    const name = truncate(doc.fileName, 60);
    const captionPreview = truncate((doc.caption || '').replace(/\n{3,}/g, '\n\n'), 200);

    const lines: string[] = [
      `🎲 <b>Random ROM!</b>\n`,
      `📁 <b>${esc(name)}</b>`,
    ];
    if (doc.category)  lines.push(`🏷️ Category: <b>${esc(doc.category)}</b>`);
    if (doc.fileSize)  lines.push(`💾 Size: ${esc(formatFileSize(doc.fileSize))}`);
    if (captionPreview) lines.push(`\n📝 <b>Caption:</b>\n${esc(captionPreview)}`);
    lines.push(`\n🔗 <a href="${link}">Open in Channel</a>`);

    await ctx.reply(lines.join('\n'), {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [
            { text: '⬇️ Download', url: link },
            { text: '🎲 Another Random', callback_data: 'random_again' },
          ],
        ],
      },
    });

    logger.debug(`/random served ${doc.channelId}/${doc.messageId} to user ${ctx.from!.id}`);
  } catch (error) {
    logger.error('/random error:', error);
    await ctx.reply(
      '❌ Something went wrong. Please try again.',
      { parse_mode: 'HTML' }
    );
  }
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
