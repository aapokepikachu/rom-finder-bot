import { Context } from 'telegraf';
import { config } from '../config';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function startCommand(ctx: Context): Promise<void> {
  const firstName = esc(ctx.from?.first_name ?? 'there');

  await ctx.reply(
    `🎮 <b>Welcome to ROM Finder, ${firstName}!</b>\n\n` +
    `I search for ROM files across multiple Telegram channels.\n\n` +
    `<b>Commands:</b>\n` +
    `🔍 /search – Find a ROM by name\n` +
    `🏆 /top – Top 5 most searched ROMs\n` +
    `⭐ /featured – Featured ROMs list\n` +
    `ℹ️ /about – About this bot\n` +
    `❓ /help – Command guide\n` +
    `🏓 /ping – Check bot latency\n\n` +
    `<i>Tip: Use /search and pick a category for faster results!</i>`,
    { parse_mode: 'HTML' }
  );
}

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `📖 <b>ROM Finder – Command Guide</b>\n\n` +
    `<b>User Commands:</b>\n` +
    `• /start – Welcome message\n` +
    `• /search – Search for a ROM (guided)\n` +
    `• /top – Top 5 most searched ROMs\n` +
    `• /featured – Admin-curated ROM list\n` +
    `• /about – Bot info\n` +
    `• /ping – Check response time\n` +
    `• /help – This guide\n\n` +
    `<b>How to Search:</b>\n` +
    `1. Send /search\n` +
    `2. Pick a category (or "Search All")\n` +
    `3. Type the ROM name\n` +
    `4. Get the best match + other results!\n\n` +
    `<b>Tips:</b>\n` +
    `• Partial names work — "pokemon" finds all Pokémon ROMs\n` +
    `• Use "I'm not sure" to search all categories\n` +
    `• Tap ✅ / ❌ after results to improve future searches`,
    { parse_mode: 'HTML' }
  );
}

export async function aboutCommand(ctx: Context): Promise<void> {
  const ownerLink = `<a href="https://t.me/${esc(config.OWNER_HANDLE)}">${esc(config.OWNER_NAME)}</a>`;

  await ctx.reply(
    `ℹ️ <b>About ROM Finder</b>\n\n` +
    `A Telegram bot that searches ROM files across multiple channels using fuzzy matching and user-feedback-driven ranking.\n\n` +
    `📌 <b>Version:</b> 1.0.1\n` +
    `👤 <b>Made by:</b> @PokemonBots\n` +
    `🧑‍💻 <b>Owner:</b> ${ownerLink}`,
    {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [{ text: '📦 Source Code', callback_data: 'about_source' }],
        ],
      },
    }
  );
}

export async function pingCommand(ctx: Context): Promise<void> {
  const start = Date.now();
  const msg   = await ctx.reply('🏓 Pinging...');
  const ms    = Date.now() - start;

  await ctx.telegram.editMessageText(
    ctx.chat!.id,
    msg.message_id,
    undefined,
    `🏓 <b>Pong!</b>\n\n⚡ Latency: <b>${ms}ms</b>`,
    { parse_mode: 'HTML' }
  );
}
