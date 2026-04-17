import { Context } from 'telegraf';
import { getCollectionCounts, estimateStorageUsage } from '../services/database';
import { User } from '../models/User';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { Featured } from '../models/Featured';
import { ChannelMessage } from '../models/ChannelMessage';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { setSession } from '../services/session';
import {
  buildAdminSettingsKeyboard,
  buildDbToolsKeyboard,
  buildChannelMappingKeyboard,
  buildFeaturedPositionKeyboard,
} from '../utils/keyboards';
import { config } from '../config';
import { escapeMarkdown } from '../utils/helpers';
import { logger } from '../utils/logger';

export async function helpAdminCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `🔧 *Admin Command Guide*\n\n` +
    `*Settings & Config:*\n` +
    `• /set – Open settings menu\n` +
    `• /db – Database tools & stats\n` +
    `• /broadcast – Send message to all users\n` +
    `• /users – View user statistics\n` +
    `• /backfill – Index historical channel messages\n` +
    `• /helpa – This help message\n\n` +
    `*Settings Menu \\(/set\\):*\n` +
    `• Map channels → custom labels\n` +
    `• Set featured ROMs \\(up to 10\\)\n` +
    `• Set "Request It\\!" URL\n\n` +
    `*Database Tools \\(/db\\):*\n` +
    `• View DB & cache stats\n` +
    `• Clear search cache\n` +
    `• Delete all data \\(with confirmation\\)\n\n` +
    `*Broadcast \\(/broadcast\\):*\n` +
    `• Sends to all active users\n` +
    `• Skips blocked/deleted accounts\n` +
    `• Reports delivery stats`,
    { parse_mode: 'MarkdownV2' }
  );
}

export async function setCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    '⚙️ *Settings Menu*\n\nChoose what to configure:',
    { parse_mode: 'MarkdownV2', reply_markup: buildAdminSettingsKeyboard() }
  );
}

export async function dbCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    '🗄️ *Database Tools*\n\nSelect an action:',
    { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
  );
}

export async function usersCommand(ctx: Context): Promise<void> {
  const [total, blocked, deleted, activeToday] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ isBlocked: true }),
    User.countDocuments({ isDeleted: true }),
    User.countDocuments({
      lastActiveAt: { $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    }),
  ]);
  const active = total - blocked - deleted;
  await ctx.reply(
    `👥 *User Statistics*\n\n` +
    `📊 Total Users: *${total}*\n` +
    `✅ Active Users: *${active}*\n` +
    `🕐 Active Today: *${activeToday}*\n` +
    `🚫 Blocked Bot: *${blocked}*\n` +
    `🗑️ Deleted Accounts: *${deleted}*`,
    { parse_mode: 'MarkdownV2' }
  );
}

// ── These are called by callback handlers — they do NOT call answerCbQuery ──
// The caller in callbacks.ts is responsible for answerCbQuery ONCE before calling these

export async function handleDbStats(ctx: Context): Promise<void> {
  try {
    const counts     = await getCollectionCounts();
    const storage    = estimateStorageUsage(counts);
    const cacheStats = cacheService.getStats();
    const emoji      = storage.warningLevel === 'critical' ? '🔴' : storage.warningLevel === 'warn' ? '🟡' : '🟢';

    const lines: string[] = [
      `📊 *Database Statistics*\n`,
      `*Document Counts:*`,
      `• 📁 Channel Messages: *${counts['ChannelMessage'] ?? 0}*`,
      `• 👥 Users: *${counts['User'] ?? 0}*`,
      `• 🔍 Search Records: *${counts['Search'] ?? 0}*`,
      `• 📡 Channel Mappings: *${counts['Channel'] ?? 0}*`,
      `• ⭐ Featured ROMs: *${counts['Featured'] ?? 0}*`,
      `• 💬 Feedback Records: *${counts['SearchFeedback'] ?? 0}*`,
      ``,
      `*Storage \\(Estimated\\):*`,
      `${emoji} ~${escapeMarkdown(storage.estimatedMB.toFixed(2))} MB / 512 MB \\(${escapeMarkdown(storage.percentUsed)}\\)`,
      ``,
      `*Cache \\(In\\-Memory\\):*`,
      `• Queries cached: ${cacheStats.keys}/${cacheStats.maxSize}`,
      `• Hit rate: ${escapeMarkdown(cacheStats.hitRate)}`,
      `• Hits: ${cacheStats.hits} \\| Misses: ${cacheStats.misses}`,
    ];

    await ctx.editMessageText(
      lines.join('\n'),
      { parse_mode: 'MarkdownV2', reply_markup: buildDbToolsKeyboard() }
    );
  } catch (error) {
    logger.error('handleDbStats error:', error);
    // Fallback — no parse_mode so special chars don't break it
    await ctx.editMessageText(
      `Stats error: ${String(error)}`,
      { reply_markup: buildDbToolsKeyboard() }
    );
  }
}

export async function handleShowChannelMapping(ctx: Context): Promise<void> {
  // NOTE: caller must answerCbQuery BEFORE calling this
  const allChannels = config.CHANNELS;
  if (allChannels.length === 0) {
    await ctx.editMessageText(
      '⚠️ No channels in `CHANNELS` env var\\.\n\nAdd channel IDs \\(comma\\-separated\\) and redeploy\\.',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const mappedChannels = await Channel.find({}).lean();

  await ctx.editMessageText(
    `📡 *Channel Mapping*\n\n` +
    `Tap a channel to set its label\\.\n` +
    `The label becomes a button in /search\\.\n` +
    `✅ = already mapped`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels as any),
    }
  );
}

export async function handleShowFeatured(ctx: Context): Promise<void> {
  // NOTE: caller must answerCbQuery BEFORE calling this
  const featured = await Featured.find({}).sort({ position: 1 }).lean();
  const existingPositions = featured.map((f) => f.position);

  let text = `⭐ *Manage Featured ROMs*\n\n`;
  if (featured.length === 0) {
    text += '_No featured ROMs set yet\\._\n\n';
  } else {
    featured.forEach((f) => {
      text += `${f.position}\\. ${escapeMarkdown(f.title)}\n`;
    });
    text += '\n';
  }
  text += 'Select a position to set/replace:';

  await ctx.editMessageText(text, {
    parse_mode: 'MarkdownV2',
    reply_markup: buildFeaturedPositionKeyboard(existingPositions),
  });
}

export async function handleSetRequestUrl(ctx: Context): Promise<void> {
  // NOTE: caller must answerCbQuery BEFORE calling this
  const setting = await Setting.findOne({ key: SETTING_KEYS.REQUEST_URL }).lean();
  const current = setting?.value;

  setSession(ctx.from!.id, { step: 'set_request_url' });

  await ctx.editMessageText(
    `🔗 *Set Request\\-It URL*\n\n` +
    `Current: ${current ? escapeMarkdown(current) : '_Not set_'}\n\n` +
    `Send the new URL \\(e\\.g\\. a Google Form or Telegram group\\):`,
    { parse_mode: 'MarkdownV2' }
  );
}
