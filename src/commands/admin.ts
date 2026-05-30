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
    `🔧 <b>Admin Command Reference</b>\n\n` +

    `<b>/set</b> — Settings menu\n` +
    `  • <b>Map Channels</b> — assign a label to each channel; that label becomes a /search category button\n` +
    `  • <b>Set Tag Category</b> — create a /search button that filters all channels by a caption hashtag (e.g. <code>#emulator</code> → "Emulators" button)\n` +
    `  • <b>Manage Tag Categories</b> — view and remove existing tag categories\n` +
    `  • <b>Set Featured ROMs</b> — pin up to 10 ROMs in /featured (forward a file or send <code>Title | channelId | msgId</code>)\n` +
    `  • <b>Set Request-It URL</b> — shown to users when a search returns no results\n\n` +

    `<b>/db</b> — Database tools\n` +
    `  • View document counts and estimated storage vs the 512 MB Atlas M0 limit\n` +
    `  • Clear in-memory search cache or message index\n` +
    `  • Delete all data (requires confirmation)\n\n` +

    `<b>/users</b> — User statistics\n` +
    `  • Total, active, active today, blocked, deleted\n\n` +

    `<b>/broadcast</b> — Message all users\n` +
    `  • 4-step flow: compose → pick format (Plain/HTML/Markdown) → test-send to you for validation → confirm send\n` +
    `  • Validation catches formatting errors before the broadcast goes out\n\n` +

    `<b>/backfill</b> — Index historical channel files\n` +
    `  • Scans a channel's full message history and indexes all files\n` +
    `  • Safe to re-run — resumes from the last indexed ID\n` +
    `  • Tip: turn /maintenance ON first to avoid partial results during indexing\n\n` +

    `<b>/maintenance</b> — Toggle user access lock\n` +
    `  • ON: all user commands blocked; admins and channel indexing always continue\n` +
    `  • OFF: bot fully live again\n` +
    `  • State persists across restarts\n\n` +

    `<b>/unindex</b> — Remove files from the search index\n` +
    `  • <b>Block a tag</b> — deletes all files with that caption tag from index; skips them in future indexing\n` +
    `  • <b>Unindex a specific file</b> — forward the file from the channel to remove it\n` +
    `  • <b>View/remove blocked tags</b> — manage the blocked tag list\n\n` +

    `<b>/random_edit</b> — Control what appears in /random\n` +
    `  • <b>Exclude by tag</b> — hides all files with a caption tag from /random (they stay searchable)\n` +
    `  • <b>Exclude a specific file</b> — forward it to hide from /random only\n` +
    `  • <b>View/remove exclusions</b> — manage both excluded tags and individual files\n\n` +

    `<b>/set_search_hint</b> — Customise the "be more specific" message
` +
    `  • Shown when a user types a single generic word during /search
` +
    `  • Use <code>{query}</code> in the text — replaced with the user's word
` +
    `  • Send /set_search_hint again to update it any time\n\n` +

    `<b>/failed_searches</b> — Search failure analytics\n` +
    `  • Top Failed Queries — queries with zero results, sorted by frequency\n` +
    `  • Failed by Category — same data per search category\n` +
    `  • High-Miss Categories — categories with most bad feedback (needs 5+ votes)\n` +
    `  • Clear Log — reset after you have reviewed and acted on it\n` +
    `  Use regularly to discover what to /backfill next\n\n` +

    `<b>Automatic Smart Search (no config needed)</b>\n` +
    `  • Feedback decay — votes older than ~30 days lose weight\n` +
    `  • Did you mean X? — close file name suggestions on zero results\n` +
    `  • Category miss-rate tip — hint to try Search All shown when category has high miss rate\n` +
    `  • Try all channels button — on zero-result pages when a category was used\n\n` +

    `<b>/helpa</b> — This reference`,
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
      `• 💬 Result Feedback: <b>${counts['SearchFeedback'] ?? 0}</b>\n` +
      `• 🏷️ Category Feedback: <b>${counts['CategoryFeedback'] ?? 0}</b>\n` +
      `• ❌ Failed Searches: <b>${counts['FailedSearch'] ?? 0}</b>\n\n` +
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

export async function setSearchHintCommand(ctx: Context): Promise<void> {
  const s = await Setting.findOne({ key: SETTING_KEYS.VAGUE_SEARCH_HINT }).lean();
  const current = s?.value;

  setSession(ctx.from!.id, { step: 'set_search_hint' });

  await ctx.reply(
    `✏️ <b>Set Vague-Search Hint</b>\n\n` +
    `This message appears when a user types a single generic word (e.g. <code>Pokemon</code>) after selecting a category.\n\n` +
    `Use <code>{query}</code> anywhere in the text — it will be replaced with the user's actual word.\n\n` +
    `<b>Current hint:</b>\n${current ? esc(current) : '<i>Default (not customised)</i>'}\n\n` +
    `<b>Send your new hint text now.</b>\n` +
    `Max 600 characters. Example:\n` +
    `<code>💡 "{query}" is very broad — try adding a platform like GBA or NDS!</code>\n\n` +
    `<i>Send /cancel to keep the current hint.</i>`,
    { parse_mode: 'HTML' }
  );
}
