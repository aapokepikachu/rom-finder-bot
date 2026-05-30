import { Context } from 'telegraf';
import { config } from '../config';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export async function startCommand(ctx: Context): Promise<void> {
  const firstName = esc(ctx.from?.first_name ?? 'there');

  await ctx.reply(
    `🎮 <b>Welcome to ROM Finder, ${firstName}!</b>\n\n` +
    `I search for ROM files across multiple Telegram channels using fuzzy matching.\n\n` +
    `<b>What can I do?</b>\n` +
    `🔍 /search – Find a ROM by name\n` +
    `🎲 /random – Get a surprise random ROM\n` +
    `🏆 /top – Top 5 most searched ROMs\n` +
    `⭐ /featured – Curated picks from admins\n` +
    `❓ /help – Full command guide\n\n` +
    `<i>Tip: Use /search and pick a category for faster, more accurate results!</i>`,
    { parse_mode: 'HTML' }
  );
}

export async function helpCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `📖 <b>ROM Finder — Help Guide</b>\n\n` +

    `<b>🔍 Searching for a ROM</b>\n` +
    `1. Send /search\n` +
    `2. Pick a category from the buttons (or tap <i>Search All</i>)\n` +
    `3. Type the ROM name — partial names work!\n` +
    `4. Tap ✅ or ❌ to tell me if the result was right\n\n` +

    `<b>💡 Search Tips</b>\n` +
    `• Be specific — instead of just <code>Pokemon</code>, try <code>Pokemon Fire Red GBA</code>\n` +
    `• Typos are OK — fuzzy search handles minor mistakes\n` +
    `• Not sure which category? Use <i>Search All</i>\n` +
    `• Your ✅/❌ feedback makes results better for everyone\n\n` +

    `<b>📋 Commands</b>\n` +
    `• /search – Find a ROM by name\n` +
    `• /random – Get a surprise random ROM\n` +
    `• /top – Top 5 most searched ROMs\n` +
    `• /featured – Admin-curated ROM picks\n` +
    `• /about – Bot info and version\n` +
    `• /ping – Check bot response time\n` +
    `• /help – This guide`,
    { parse_mode: 'HTML' }
  );
}

export async function aboutCommand(ctx: Context): Promise<void> {
  const ownerLink = `<a href="https://t.me/${esc(config.OWNER_HANDLE)}">${esc(config.OWNER_NAME)}</a>`;

  await ctx.reply(
    `ℹ️ <b>About ROM Finder</b>\n\n` +
    `A Telegram bot that searches ROM files across multiple channels using fuzzy matching and user-feedback-driven ranking.\n\n` +
    `📌 <b>Version:</b> 1.2.0\n` +
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
