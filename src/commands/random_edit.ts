import { Context } from 'telegraf';
import { ChannelMessage } from '../models/ChannelMessage';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { setSession, clearSession } from '../services/session';
import { logger } from '../utils/logger';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── /random_edit entry point ───────────────────────────────────────────────

export async function randomEditCommand(ctx: Context): Promise<void> {
  const [tagSetting, idSetting] = await Promise.all([
    Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS }).lean(),
    Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_IDS }).lean(),
  ]);

  const excludedTags = tagSetting?.value
    ? tagSetting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];
  const excludedIds = idSetting?.value
    ? idSetting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const tagsDisplay = excludedTags.length > 0
    ? excludedTags.map((t) => `<code>${esc(t)}</code>`).join('  ')
    : '<i>None</i>';

  await ctx.reply(
    `🎲 <b>Random ROM — Exclusion Manager</b>\n\n` +
    `Control which files can appear in <b>/random</b>.\n\n` +
    `<b>Excluded tags:</b> ${tagsDisplay}\n` +
    `<b>Excluded individual files:</b> ${excludedIds.length}\n\n` +
    `Choose an action:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏷️ Exclude by Tag',              callback_data: 'rand_edit:tag_prompt'  }],
          [{ text: '📩 Exclude a Specific File',      callback_data: 'rand_edit:file_prompt' }],
          [{ text: '📋 View & Remove Excluded Tags',  callback_data: 'rand_edit:tag_list'    }],
          [{ text: '📋 View & Remove Excluded Files', callback_data: 'rand_edit:file_list'   }],
          [{ text: '❌ Cancel',                        callback_data: 'admin_cancel'           }],
        ],
      },
    }
  );
}

// ── Show the tag exclusion prompt ──────────────────────────────────────────

export async function handleRandEditTagPrompt(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  setSession(ctx.from!.id, { step: 'rand_exclude_tag' });

  await ctx.editMessageText(
    `🏷️ <b>Exclude by Tag — /random</b>\n\n` +
    `Files whose caption contains this tag will <b>never</b> appear in /random.\n` +
    `(They will still appear in /search — use /unindex to remove from search too.)\n\n` +
    `<b>Send the hashtag</b> (must start with <code>#</code>):\n` +
    `Examples: <code>#misc</code>, <code>#test</code>, <code>#nsfw</code>\n\n` +
    `<i>Send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Handle the tag text input ──────────────────────────────────────────────

export async function handleRandExcludeTagInput(ctx: Context, tag: string): Promise<void> {
  const userId  = ctx.from!.id;
  const cleaned = tag.trim().toLowerCase();

  if (!cleaned.startsWith('#')) {
    await ctx.reply(
      `⚠️ Tag must start with <code>#</code> — e.g. <code>#misc</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }
  if (!/^#[a-z0-9_]+$/.test(cleaned)) {
    await ctx.reply(
      `⚠️ Tag must only contain lowercase letters, numbers, and underscores after <code>#</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const s        = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS }).lean();
  const existing = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  if (existing.includes(cleaned)) {
    clearSession(userId);
    await ctx.reply(
      `ℹ️ Tag <code>${esc(cleaned)}</code> is already excluded from /random.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const updated = [...existing, cleaned].join(',');
  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS },
    { $set: { value: updated, updatedBy: userId } },
    { upsert: true }
  );

  clearSession(userId);
  logger.info(`Admin ${userId} excluded tag "${cleaned}" from /random`);

  await ctx.reply(
    `✅ <b>Tag excluded from /random!</b>\n\n` +
    `🏷️ Tag: <code>${esc(cleaned)}</code>\n\n` +
    `Files with this tag in their caption will no longer appear in /random.\n` +
    `They remain searchable via /search.`,
    { parse_mode: 'HTML' }
  );
}

// ── Show the file exclusion prompt ─────────────────────────────────────────

export async function handleRandEditFilePrompt(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  setSession(ctx.from!.id, { step: 'rand_exclude_file' });

  await ctx.editMessageText(
    `📩 <b>Exclude a Specific File — /random</b>\n\n` +
    `This hides a single file from /random. It stays in /search results.\n\n` +
    `<b>How:</b> Forward the file message from the ROM channel to me here.\n\n` +
    `<i>Forward the file now, or send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Handle forwarded message for file exclusion ────────────────────────────

export async function handleRandExcludeForward(ctx: Context): Promise<void> {
  const msg    = ctx.message as any;
  const userId = ctx.from!.id;

  const forwardFromChat = msg.forward_from_chat;
  const forwardOrigin   = msg.forward_origin;

  const channelId =
    forwardFromChat?.id?.toString() ||
    forwardOrigin?.chat?.id?.toString();
  const messageId =
    msg.forward_from_message_id ||
    forwardOrigin?.message_id;

  if (!channelId || !messageId) {
    await ctx.reply(
      '⚠️ Could not read channel info from that message.\n\n' +
      'Please forward a file message <b>directly from the ROM channel</b>.',
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Confirm the file is actually indexed
  const indexed = await ChannelMessage.findOne(
    { channelId, messageId },
    'fileName'
  ).lean();

  if (!indexed) {
    clearSession(userId);
    await ctx.reply(
      `ℹ️ <b>File not in index</b>\n\n` +
      `Message ID <code>${messageId}</code> from channel <code>${esc(channelId)}</code> ` +
      `is not indexed — nothing to exclude from /random.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const key = `${channelId}:${messageId}`;
  const s   = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_IDS }).lean();
  const existing = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  if (existing.includes(key)) {
    clearSession(userId);
    await ctx.reply(
      `ℹ️ <b>${esc(indexed.fileName)}</b> is already excluded from /random.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const updated = [...existing, key].join(',');
  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.RANDOM_EXCLUDED_IDS },
    { $set: { value: updated, updatedBy: userId } },
    { upsert: true }
  );

  clearSession(userId);
  logger.info(`Admin ${userId} excluded ${channelId}/${messageId} ("${indexed.fileName}") from /random`);

  await ctx.reply(
    `✅ <b>File excluded from /random!</b>\n\n` +
    `📁 <b>${esc(indexed.fileName)}</b>\n` +
    `📡 Channel: <code>${esc(channelId)}</code>\n` +
    `🔢 Message ID: ${messageId}\n\n` +
    `This file will no longer appear in /random.\n` +
    `It remains searchable via /search.`,
    { parse_mode: 'HTML' }
  );
}

// ── View & remove excluded tags ────────────────────────────────────────────

export async function handleRandEditTagList(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const s    = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS }).lean();
  const tags = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  if (tags.length === 0) {
    await ctx.editMessageText(
      `📋 <b>Excluded Tags — /random</b>\n\n<i>No tags excluded yet.</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]] },
      }
    );
    return;
  }

  const rows = tags.map((tag) => ([{
    text: `❌ Remove: ${tag}`,
    callback_data: `rand_remove_tag:${tag}`,
  }]));
  rows.push([{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]);

  await ctx.editMessageText(
    `📋 <b>Excluded Tags — /random</b>\n\nTap a tag to allow it back in /random:\n\n` +
    tags.map((t) => `• <code>${esc(t)}</code>`).join('\n'),
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }
  );
}

// ── View & remove excluded file IDs ───────────────────────────────────────

export async function handleRandEditFileList(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const s   = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_IDS }).lean();
  const ids = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];

  if (ids.length === 0) {
    await ctx.editMessageText(
      `📋 <b>Excluded Files — /random</b>\n\n<i>No individual files excluded yet.</i>`,
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]] },
      }
    );
    return;
  }

  // Resolve file names from DB for nicer display
  const rows: any[][] = [];
  for (const id of ids) {
    const [channelId, msgIdStr] = id.split(':');
    const messageId = parseInt(msgIdStr, 10);
    const doc = await ChannelMessage.findOne({ channelId, messageId }, 'fileName').lean();
    const label = doc?.fileName
      ? truncate(doc.fileName, 30)
      : `${channelId}:${messageId}`;
    rows.push([{ text: `❌ ${label}`, callback_data: `rand_remove_id:${id}` }]);
  }
  rows.push([{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]);

  await ctx.editMessageText(
    `📋 <b>Excluded Files — /random</b>\n\n` +
    `Tap a file to allow it back in /random:\n\n` +
    `<i>Showing ${ids.length} excluded file(s)</i>`,
    { parse_mode: 'HTML', reply_markup: { inline_keyboard: rows } }
  );
}

// ── Remove an excluded tag ─────────────────────────────────────────────────

export async function handleRandRemoveTag(ctx: Context, tag: string): Promise<void> {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;

  const s        = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS }).lean();
  const existing = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const updated  = existing.filter((t) => t !== tag);

  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.RANDOM_EXCLUDED_TAGS },
    { $set: { value: updated.join(','), updatedBy: userId } },
    { upsert: true }
  );

  logger.info(`Admin ${userId} re-allowed tag "${tag}" in /random`);

  const remaining = updated.length > 0
    ? updated.map((t) => `• <code>${esc(t)}</code>`).join('\n')
    : '<i>None</i>';

  await ctx.editMessageText(
    `✅ <b>Tag re-allowed in /random:</b> <code>${esc(tag)}</code>\n\n` +
    `Files with this tag may now appear in /random again.\n\n` +
    `<b>Still excluded:</b>\n${remaining}`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]] },
    }
  );
}

// ── Remove an excluded file ID ─────────────────────────────────────────────

export async function handleRandRemoveId(ctx: Context, id: string): Promise<void> {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;

  const s        = await Setting.findOne({ key: SETTING_KEYS.RANDOM_EXCLUDED_IDS }).lean();
  const existing = s?.value ? s.value.split(',').map((t) => t.trim()).filter(Boolean) : [];
  const updated  = existing.filter((i) => i !== id);

  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.RANDOM_EXCLUDED_IDS },
    { $set: { value: updated.join(','), updatedBy: userId } },
    { upsert: true }
  );

  const [channelId, msgIdStr] = id.split(':');
  logger.info(`Admin ${userId} re-allowed file ${channelId}/${msgIdStr} in /random`);

  await ctx.editMessageText(
    `✅ <b>File re-allowed in /random!</b>\n\n` +
    `<code>${esc(channelId)}:${esc(msgIdStr)}</code> may now appear in /random again.\n\n` +
    `<b>Remaining excluded files:</b> ${updated.length}`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'rand_edit:back' }]] },
    }
  );
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}
