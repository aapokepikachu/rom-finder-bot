import { Context } from 'telegraf';
import { config } from '../config';
import { Channel } from '../models/Channel';
import { escapeMarkdown } from '../utils/helpers';

export async function startCommand(ctx: Context): Promise<void> {
  const firstName = ctx.from?.first_name ?? 'there';

  await ctx.reply(
    `🎮 *Welcome to ROM Finder, ${escapeMarkdown(firstName)}\\!*\n\n` +
    `I can help you find ROMs across multiple Telegram channels\\.\n\n` +
    `*What I can do:*\n` +
    `🔍 /search – Find a ROM by name\n` +
    `🏆 /top – Top 5 most searched ROMs\n` +
    `⭐ /featured – Top 10 featured ROMs\n` +
    `❓ /help – Full command guide\n` +
    `ℹ️ /about – About this bot\n` +
    `🏓 /ping – Check bot latency\n\n` +
    `_Tip: Use /search and select a category for faster, more accurate results\\!_`,
    { parse_mode: 'MarkdownV2' }
  );
}

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `📖 *ROM Finder – Command Guide*\n\n` +
    `*User Commands:*\n` +
    `• /start – Welcome message\n` +
    `• /search – Search for a ROM \\(guided flow\\)\n` +
    `• /top – View top 5 most searched ROMs\n` +
    `• /featured – View admin\\-curated ROM list\n` +
    `• /about – Bot info & channel list\n` +
    `• /ping – Check bot response time\n\n` +
    `*How to Search:*\n` +
    `1\\. Use /search\n` +
    `2\\. Select a category \\(GBA, NDS, etc\\.\\)\n` +
    `3\\. Type the ROM name\n` +
    `4\\. Get the best match \\+ other results\\!\n\n` +
    `*Tips:*\n` +
    `• Partial names work \\(e\\.g\\. "pokemon" finds all Pokémon ROMs\\)\n` +
    `• Select "I'm not sure" to search all categories\n` +
    `• Use /top to discover popular ROMs`,
    { parse_mode: 'MarkdownV2' }
  );
}

export async function aboutCommand(ctx: Context): Promise<void> {
  const channels = await Channel.find({}, 'channelId category title username').lean();

  let channelList = '';
  if (channels.length > 0) {
    channelList = '\n\n*📡 Available Channels:*\n';
    for (const ch of channels) {
      const link = ch.username ? `@${ch.username}` : `Channel ${ch.channelId}`;
      channelList += `• ${escapeMarkdown(link)} → *${ch.category}*\n`;
    }
  }

  await ctx.reply(
    `ℹ️ *About ROM Finder*\n\n` +
    `ROM Finder is a Telegram bot that searches for ROM files across multiple channels\\.\n\n` +
    `*Owner:* ${escapeMarkdown(config.OWNER_NAME)}\n` +
    `*Contact:* ${escapeMarkdown(config.OWNER_USERNAME)}\n` +
    `*Version:* 1\\.0\\.0` +
    escapeMarkdown(channelList),
    { parse_mode: 'MarkdownV2' }
  );
}

export async function pingCommand(ctx: Context): Promise<void> {
  const start = Date.now();
  const msg = await ctx.reply('🏓 Pinging\\.\\.\\.');
  const latency = Date.now() - start;

  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    msg.message_id,
    undefined,
    `🏓 *Pong\\!*\n\n⚡ Latency: *${latency}ms*`,
    { parse_mode: 'MarkdownV2' }
  );
}
