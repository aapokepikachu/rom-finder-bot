import { Context } from 'telegraf';
import { User } from '../models/User';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { Featured } from '../models/Featured';
import { ChannelMessage } from '../models/ChannelMessage';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { getDBStats } from '../services/database';
import { setSession, clearSession } from '../services/session';
import {
  buildAdminSettingsKeyboard,
  buildDbToolsKeyboard,
  buildChannelMappingKeyboard,
  buildFeaturedPositionKeyboard,
} from '../utils/keyboards';
import { config } from '../config';
import { escapeMarkdown } from '../utils/helpers';

export async function helpAdminCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `🔧 *Admin Command Guide*\n\n` +
    `*Settings & Config:*\n` +
    `• /set – Open settings menu\n` +
    `• /db – Database tools & stats\n` +
    `• /broadcast – Send message to all users\n` +
    `• /users – View user statistics\n` +
    `• /helpa – This help message\n\n` +
    `*Settings Menu \\(/set\\):*\n` +
    `• Map channels → categories\n` +
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
    {
      parse_mode: 'MarkdownV2',
      reply_markup: buildAdminSettingsKeyboard(),
    }
  );
}

export async function dbCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    '🗄️ *Database Tools*\n\nSelect an action:',
    {
      parse_mode: 'MarkdownV2',
      reply_markup: buildDbToolsKeyboard(),
    }
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

// Callback: Show DB stats
export async function handleDbStats(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  try {
    const dbStats = await getDBStats();
    const cacheStats = cacheService.getStats();

    const [msgCount, userCount, searchCount] = await Promise.all([
      ChannelMessage.countDocuments(),
      User.countDocuments(),
      Search.countDocuments(),
    ]);

    await ctx.editMessageText(
      `📊 *Database Statistics*\n\n` +
      `*MongoDB:*\n` +
      `• Collections: ${dbStats.collections}\n` +
      `• Documents: ${dbStats.documents}\n` +
      `• Storage: ${escapeMarkdown(dbStats.storageSize)}\n` +
      `• Indexes: ${dbStats.indexes}\n\n` +
      `*Collections:*\n` +
      `• Channel Messages: ${msgCount}\n` +
      `• Users: ${userCount}\n` +
      `• Search Records: ${searchCount}\n\n` +
      `*Cache \\(In\\-Memory\\):*\n` +
      `• Cached Queries: ${cacheStats.keys}/${cacheStats.maxSize}\n` +
      `• Hit Rate: ${escapeMarkdown(cacheStats.hitRate)}\n` +
      `• Hits: ${cacheStats.hits} | Misses: ${cacheStats.misses}`,
      {
        parse_mode: 'MarkdownV2',
        reply_markup: buildDbToolsKeyboard(),
      }
    );
  } catch (error) {
    await ctx.editMessageText('❌ Failed to fetch DB stats. Please try again.', {
      reply_markup: buildDbToolsKeyboard(),
    });
  }
}

// Callback: Show channel mapping UI
export async function handleShowChannelMapping(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const allChannels = config.CHANNELS;
  if (allChannels.length === 0) {
    await ctx.editMessageText(
      '⚠️ No channels configured in ENV\\.\n\nAdd channel IDs to `CHANNELS` in your \\.env file\\.',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const mappedChannels = await Channel.find({}).lean();

  await ctx.editMessageText(
    `📡 *Channel → Category Mapping*\n\n` +
    `Select a channel to assign its category:\n` +
    `\\(✅ = already mapped\\)`,
    {
      parse_mode: 'MarkdownV2',
      reply_markup: buildChannelMappingKeyboard(allChannels, mappedChannels),
    }
  );
}

// Callback: Show featured management
export async function handleShowFeatured(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

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

// Callback: Show Request URL setting
export async function handleSetRequestUrl(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const setting = await Setting.findOne({ key: SETTING_KEYS.REQUEST_URL }).lean();
  const current = setting?.value;

  setSession(ctx.from!.id, { step: 'set_request_url' });

  await ctx.editMessageText(
    `🔗 *Set Request\\-It URL*\n\n` +
    `Current: ${current ? escapeMarkdown(current) : '_Not set_'}\n\n` +
    `Send the new URL \\(e\\.g\\. a Google Form or Telegram group link\\):`,
    { parse_mode: 'MarkdownV2' }
  );
}
