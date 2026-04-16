import { Context } from 'telegraf';
import { Search } from '../models/Search';
import { Featured } from '../models/Featured';
import { buildMessageLink, escapeMarkdown } from '../utils/helpers';

export async function topCommand(ctx: Context): Promise<void> {
  const topSearches = await Search.find({})
    .sort({ count: -1 })
    .limit(5)
    .lean();

  if (topSearches.length === 0) {
    await ctx.reply(
      '📊 *Top Searches*\n\nNo searches recorded yet\\. Be the first to /search\\!',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  const medals = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣'];
  let text = '📊 *Top 5 Most Searched ROMs*\n\n';

  topSearches.forEach((s, i) => {
    text +=
      `${medals[i]} *${escapeMarkdown(s.query)}*\n` +
      `   └ Searched *${s.count}* time${s.count !== 1 ? 's' : ''}\n`;
  });

  text += '\n_Use /search to find any of these ROMs\\!_';

  await ctx.reply(text, { parse_mode: 'MarkdownV2' });
}

export async function featuredCommand(ctx: Context): Promise<void> {
  const featured = await Featured.find({}).sort({ position: 1 }).lean();

  if (featured.length === 0) {
    await ctx.reply(
      '⭐ *Featured ROMs*\n\nNo featured ROMs set yet\\. Check back later\\!',
      { parse_mode: 'MarkdownV2' }
    );
    return;
  }

  let text = '⭐ *Featured ROMs*\n\n';

  for (const item of featured) {
    const link = buildMessageLink(item.channelId, item.messageId);
    text +=
      `*${item.position}\\.* [${escapeMarkdown(item.title)}](${link})`;
    if (item.category) text += ` \\[${item.category}\\]`;
    text += '\n';
  }

  text += '\n_Click any title to download\\!_';

  await ctx.reply(text, {
    parse_mode: 'MarkdownV2',
    link_preview_options: { is_disabled: true },
  });
}
