import { Context } from 'telegraf';
import { FailedSearch } from '../models/FailedSearch';
import { CategoryFeedback } from '../models/CategoryFeedback';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function truncate(text: string, max: number): string {
  return text.length <= max ? text : text.slice(0, max - 3) + '...';
}

// ── /failed_searches command ────────────────────────────────────────────────

export async function failedSearchesCommand(ctx: Context): Promise<void> {
  await ctx.reply(
    `🔍 <b>Failed Search Analytics</b>\n\n` +
    `Understand what users can't find so you can backfill the right files.\n\n` +
    `Choose a view:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '📊 Top Failed Queries (All Categories)', callback_data: 'fs:top_all'      }],
          [{ text: '🏷️ Top Failed Queries (By Category)',   callback_data: 'fs:top_by_cat'   }],
          [{ text: '⚠️ High-Miss Categories',               callback_data: 'fs:bad_cats'      }],
          [{ text: '🗑️ Clear Failed Search Log',            callback_data: 'fs:clear_prompt'  }],
          [{ text: '❌ Close',                               callback_data: 'admin_cancel'      }],
        ],
      },
    }
  );
}

// ── Top failed queries across all categories ────────────────────────────────

export async function handleFsTopAll(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const results = await FailedSearch.find({})
    .sort({ count: -1 })
    .limit(15)
    .lean();

  if (results.length === 0) {
    await ctx.editMessageText(
      `📊 <b>Top Failed Queries</b>\n\n✅ <i>No failed searches recorded yet!</i>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] } }
    );
    return;
  }

  // Merge same query across different categories for a global ranking
  const merged = new Map<string, { query: string; totalCount: number; categories: string[] }>();
  for (const r of results) {
    const key = r.normalizedQuery;
    if (!merged.has(key)) {
      merged.set(key, { query: r.query, totalCount: 0, categories: [] });
    }
    const m = merged.get(key)!;
    m.totalCount += r.count;
    if (!m.categories.includes(r.categoryLabel)) m.categories.push(r.categoryLabel);
  }

  const sorted = [...merged.entries()]
    .sort((a, b) => b[1].totalCount - a[1].totalCount)
    .slice(0, 10);

  let text = `📊 <b>Top Failed Queries</b>\n<i>Queries users searched but found nothing</i>\n\n`;
  sorted.forEach(([, { query, totalCount, categories }], i) => {
    const cats = categories.slice(0, 2).map(esc).join(', ');
    text += `${i + 1}. <code>${esc(truncate(query, 40))}</code>\n`;
    text += `   ❌ ${totalCount} failed attempt${totalCount !== 1 ? 's' : ''}`;
    if (cats) text += ` — in: <i>${cats}</i>`;
    text += '\n';
  });

  text += `\n💡 <i>Consider running /backfill for these files.</i>`;

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] },
  });
}

// ── Top failed queries grouped by category ──────────────────────────────────

export async function handleFsTopByCat(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const results = await FailedSearch.find({})
    .sort({ count: -1 })
    .limit(30)
    .lean();

  if (results.length === 0) {
    await ctx.editMessageText(
      `🏷️ <b>Failed Queries by Category</b>\n\n✅ <i>No failed searches recorded yet!</i>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] } }
    );
    return;
  }

  // Group by category
  const byCat = new Map<string, { label: string; entries: typeof results }>();
  for (const r of results) {
    if (!byCat.has(r.category)) byCat.set(r.category, { label: r.categoryLabel, entries: [] });
    byCat.get(r.category)!.entries.push(r);
  }

  let text = `🏷️ <b>Failed Queries by Category</b>\n\n`;
  let catCount = 0;
  for (const [, { label, entries }] of byCat) {
    if (catCount >= 5) break; // cap at 5 categories to avoid message too long
    text += `<b>${esc(label)}:</b>\n`;
    entries.slice(0, 5).forEach((e) => {
      text += `  • <code>${esc(truncate(e.query, 35))}</code> (${e.count}x)\n`;
    });
    text += '\n';
    catCount++;
  }

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] },
  });
}

// ── Categories with high miss rates ─────────────────────────────────────────

export async function handleFsBadCats(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  // Aggregate CategoryFeedback for miss rates per category
  const agg = await CategoryFeedback.aggregate([
    {
      $group: {
        _id:    '$category',
        label:  { $last: '$categoryLabel' },
        total:  { $sum: 1 },
        misses: { $sum: { $cond: [{ $eq: ['$helpful', false] }, 1, 0] } },
      },
    },
    { $match: { total: { $gte: 5 } } },  // need at least 5 votes
    { $sort: { misses: -1 } },
    { $limit: 10 },
  ]);

  if (agg.length === 0) {
    await ctx.editMessageText(
      `⚠️ <b>High-Miss Categories</b>\n\n` +
      `<i>Not enough category feedback data yet.\n` +
      `Users need to submit ✅/❌ feedback after searches for this to populate.</i>`,
      { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] } }
    );
    return;
  }

  let text = `⚠️ <b>High-Miss Rate Categories</b>\n`;
  text += `<i>Categories where users frequently don't find what they need</i>\n\n`;

  agg.forEach((row) => {
    const missRate = ((row.misses / row.total) * 100).toFixed(0);
    const bar = missRate >= '70' ? '🔴' : missRate >= '50' ? '🟡' : '🟢';
    text += `${bar} <b>${esc(row.label || row._id)}</b>\n`;
    text += `   Miss rate: <b>${missRate}%</b> (${row.misses}/${row.total} votes)\n`;
  });

  text += `\n💡 <i>Consider remapping or adding more files to high-miss categories.</i>`;

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'fs:back' }]] },
  });
}

// ── Clear failed search log ──────────────────────────────────────────────────

export async function handleFsClearPrompt(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  const count = await FailedSearch.countDocuments();
  await ctx.editMessageText(
    `🗑️ <b>Clear Failed Search Log</b>\n\n` +
    `This will permanently delete <b>${count}</b> failed search record${count !== 1 ? 's' : ''}.\n\n` +
    `The data is used to show you what users can't find. Clear only after you've reviewed it.\n\n` +
    `<b>Are you sure?</b>`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🗑️ Yes, Clear It',  callback_data: 'fs:clear_confirm' }],
          [{ text: '⬅️ Cancel',          callback_data: 'fs:back'          }],
        ],
      },
    }
  );
}

export async function handleFsClearConfirm(ctx: Context): Promise<void> {
  await ctx.answerCbQuery('🗑️ Clearing...');
  const result = await FailedSearch.deleteMany({});
  await ctx.editMessageText(
    `✅ <b>Failed search log cleared.</b>\n\n` +
    `Deleted <b>${result.deletedCount}</b> record${result.deletedCount !== 1 ? 's' : ''}.\n\n` +
    `Fresh data will accumulate as users search again.`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Close', callback_data: 'admin_cancel' }]] } }
  );
}
