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
import { logger } from '../utils/logger';

// Use HTML parse mode throughout — far more forgiving than MarkdownV2.
// MarkdownV2 breaks on ~, >, #, +, -, =, |, {, }, (, ), . unless all escaped.

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

export async function helpAdminCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `🔧 <b>Admin Command Guide</b>\n\n` +
    `<b>Commands:</b>\n` +
    `• /set – Settings menu\n` +
    `• /db – Database tools\n` +
    `• /broadcast – Message all users\n` +
    `• /users – User statistics\n` +
    `• /backfill – Index historical channel files\n` +
    `• /maintenance – Toggle maintenance mode\n` +
    `• /unindex – Remove files from search index\n` +
    `• /helpa – This help\n\n` +
    `<b>Settings (/set):</b>\n` +
    `• Map channels → search buttons\n` +
    `• Set featured ROMs (up to 10)\n` +
    `• Set "Request It!" URL\n\n` +
    `<b>DB Tools (/db):</b>\n` +
    `• Usage stats (works on Atlas M0)\n` +
    `• Clear cache / index\n` +
    `• Delete all data\n\n` +
    `<b>Backfill (/backfill):</b>\n` +
    `• Scans old channel messages\n` +
    `• Indexes files not seen live\n\n` +
    `<b>Maintenance (/maintenance):</b>\n` +
    `• Blocks all users while ON\n` +
    `• Admins always pass through\n` +
    `• Useful during /backfill or updates\n\n` +
    `<b>Unindex (/unindex):</b>\n` +
    `• Block a tag — skip files with that caption tag\n` +
    `• Unindex a file — forward it to remove from index\n` +
    `• View/remove blocked tags`,
    { parse_mode: 'HTML' }
  );
}

export async function setCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    '⚙️ <b>Settings Menu</b>\n\nChoose what to configure:',
    { parse_mode: 'HTML', reply_markup: buildAdminSettingsKeyboard() }
  );
}

export async function dbCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    '🗄️ <b>Database Tools</b>\n\nSelect an action:',
    { parse_mode: 'HTML', reply_markup: buildDbToolsKeyboard() }
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
    `👥 <b>User Statistics</b>\n\n` +
    `📊 Total: <b>${total}</b>\n` +
    `✅ Active: <b>${active}</b>\n` +
    `🕐 Active today: <b>${activeToday}</b>\n` +
    `🚫 Blocked bot: <b>${blocked}</b>\n` +
    `🗑️ Deleted accounts: <b>${deleted}</b>`,
    { parse_mode: 'HTML' }
  );
}

// ── Called by callback handler — caller already called answerCbQuery() ───────

export async function handleDbStats(ctx: Context): Promise<void> {
  // NOTE: Atlas M0 does NOT support db.stats(). We use countDocuments() only.
  try {
    const counts     = await getCollectionCounts();
    const storage    = estimateStorageUsage(counts);
    const cacheStats = cacheService.getStats();
    const emoji      = storage.warningLevel === 'critical' ? '🔴'
                     : storage.warningLevel === 'warn'     ? '🟡' : '🟢';

    const text =
      `📊 <b>Database Statistics</b>\n\n` +
      `<b>Document Counts:</b>\n` +
      `• 📁 Channel Messages: <b>${counts['ChannelMessage'] ?? 0}</b>\n` +
      `• 👥 Users: <b>${counts['User'] ?? 0}</b>\n` +
      `• 🔍 Search Records: <b>${counts['Search'] ?? 0}</b>\n` +
      `• 📡 Channel Mappings: <b>${counts['Channel'] ?? 0}</b>\n` +
      `• ⭐ Featured ROMs: <b>${counts['Featured'] ?? 0}</b>\n` +
      `• 💬 Feedback: <b>${counts['SearchFeedback'] ?? 0}</b>\n\n` +
      `<b>Storage (estimated):</b>\n` +
      `${emoji} ~${storage.estimatedMB.toFixed(2)} MB / 512 MB (${storage.percentUsed})\n\n` +
      `<b>Cache (in-memory):</b>\n` +
      `• Queries cached: ${cacheStats.keys}/${cacheStats.maxSize}\n` +
      `• Hit rate: ${cacheStats.hitRate}\n` +
      `• Hits: ${cacheStats.hits} | Misses: ${cacheStats.misses}`;

    await ctx.editMessageText(text, {
      parse_mode: 'HTML',
      reply_markup: buildDbToolsKeyboard(),
    });
  } catch (error) {
    logger.error('handleDbStats error:', error);
    await ctx.editMessageText(
      `❌ Stats error:\n<code>${esc(String(error))}</code>`,
      { parse_mode: 'HTML', reply_markup: buildDbToolsKeyboard() }
    );
  }
}

export async function handleShowChannelMapping(ctx: Context): Promise<void> {
  const allChannels = config.CHANNELS;
  if (allChannels.length === 0) {
    await ctx.editMessageText(
      '⚠️ No channels found in the <code>CHANNELS</code> environment variable.\n\n' +
      'Add comma-separated channel IDs to your Render environment and redeploy.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  const mappedChannels = await Channel.find({}).lean();

  await ctx.editMessageText(
    `📡 <b>Channel Mapping</b>\n\n` +
    `Tap a channel button to set its label.\n` +
    `That label becomes a search button in /search.\n` +
    `✅ = already mapped`,
    {
      parse_mode: 'HTML',
      reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels as any),
    }
  );
}

export async function handleShowFeatured(ctx: Context): Promise<void> {
  const featured          = await Featured.find({}).sort({ position: 1 }).lean();
  const existingPositions = featured.map((f) => f.position);

  let text = `⭐ <b>Manage Featured ROMs</b>\n\n`;
  if (featured.length === 0) {
    text += '<i>No featured ROMs set yet.</i>\n\n';
  } else {
    featured.forEach((f) => {
      text += `${f.position}. ${esc(f.title)}\n`;
    });
    text += '\n';
  }
  text += 'Select a position to set or replace:';

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: buildFeaturedPositionKeyboard(existingPositions),
  });
}

export async function handleSetRequestUrl(ctx: Context): Promise<void> {
  const setting = await Setting.findOne({ key: SETTING_KEYS.REQUEST_URL }).lean();
  const current = setting?.value;

  setSession(ctx.from!.id, { step: 'set_request_url' });

  await ctx.editMessageText(
    `🔗 <b>Set Request-It URL</b>\n\n` +
    `Current: ${current ? `<code>${esc(current)}</code>` : '<i>Not set</i>'}\n\n` +
    `Send the new URL (e.g. a Google Form or group link).\n` +
    `<i>Send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}
