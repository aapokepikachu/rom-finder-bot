import { Context } from 'telegraf';
import { ChannelMessage } from '../models/ChannelMessage';
import { Setting, SETTING_KEYS } from '../models/Setting';
import { cacheService } from '../services/cache';
import { setSession, clearSession } from '../services/session';
import { logger } from '../utils/logger';

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ── /unindex entry point ───────────────────────────────────────────────────

export async function unindexCommand(ctx: Context): Promise<void> {
  // Show current blocked tags for context
  const setting    = await Setting.findOne({ key: SETTING_KEYS.BLOCKED_TAGS }).lean();
  const currentTags = setting?.value
    ? setting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const tagsDisplay = currentTags.length > 0
    ? currentTags.map((t) => `<code>${esc(t)}</code>`).join('  ')
    : '<i>None set</i>';

  await ctx.reply(
    `🗑️ <b>Unindex Manager</b>\n\n` +
    `Use this to prevent certain files from appearing in search results.\n\n` +
    `<b>Currently blocked tags:</b>\n${tagsDisplay}\n\n` +
    `Choose an action:`,
    {
      parse_mode: 'HTML',
      reply_markup: {
        inline_keyboard: [
          [{ text: '🏷️ Block a Tag (skip files with this tag)', callback_data: 'unindex:tag'     }],
          [{ text: '📩 Unindex a Specific File',                callback_data: 'unindex:forward' }],
          [{ text: '📋 View & Remove Blocked Tags',             callback_data: 'unindex:list'    }],
          [{ text: '❌ Cancel',                                  callback_data: 'admin_cancel'    }],
        ],
      },
    }
  );
}

// ── Callback: Block a Tag ──────────────────────────────────────────────────

export async function handleUnindexTagPrompt(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  setSession(ctx.from!.id, { step: 'unindex_by_tag' });

  await ctx.editMessageText(
    `🏷️ <b>Block a Tag</b>\n\n` +
    `When a file's caption contains a blocked tag, it will be:\n` +
    `  • <b>Skipped</b> during live indexing (new posts)\n` +
    `  • <b>Skipped</b> during /backfill\n` +
    `  • <b>Removed</b> from the current index immediately\n\n` +
    `<b>How to use:</b>\n` +
    `Add a hashtag to the file's caption in the channel (e.g. <code>#misc</code>, <code>#skip</code>, <code>#test</code>), then block that tag here.\n\n` +
    `<b>Send the tag to block</b> (must start with <code>#</code>):\n` +
    `Example: <code>#misc</code>\n\n` +
    `<i>Send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Callback: Unindex a specific file ─────────────────────────────────────

export async function handleUnindexForwardPrompt(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();
  setSession(ctx.from!.id, { step: 'unindex_by_forward' });

  await ctx.editMessageText(
    `📩 <b>Unindex a Specific File</b>\n\n` +
    `This removes a single file from the search index so it will never appear in results.\n\n` +
    `<b>How to do it:</b>\n` +
    `Forward the file message from the ROM channel directly to me here.\n\n` +
    `<b>What happens:</b>\n` +
    `  • The file is deleted from the index database\n` +
    `  • The search cache is cleared\n` +
    `  • It will no longer appear in any search results\n` +
    `  • If the channel is backfilled again, the file stays excluded\n\n` +
    `<i>Forward the file now, or send /cancel to abort.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Callback: View & remove blocked tags ──────────────────────────────────

export async function handleUnindexList(ctx: Context): Promise<void> {
  await ctx.answerCbQuery();

  const setting  = await Setting.findOne({ key: SETTING_KEYS.BLOCKED_TAGS }).lean();
  const tags     = setting?.value
    ? setting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  if (tags.length === 0) {
    await ctx.editMessageText(
      '📋 <b>Blocked Tags</b>\n\n<i>No tags are currently blocked.</i>',
      {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'unindex:back' }]] },
      }
    );
    return;
  }

  const rows = tags.map((tag) => ([{
    text: `❌ Remove: ${tag}`,
    callback_data: `unindex_remove_tag:${tag}`,
  }]));
  rows.push([{ text: '⬅️ Back', callback_data: 'unindex:back' }]);

  await ctx.editMessageText(
    `📋 <b>Blocked Tags</b>\n\n` +
    `Tap a tag to unblock it (files with that tag will be indexed again):\n\n` +
    tags.map((t) => `• <code>${esc(t)}</code>`).join('\n'),
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: rows },
    }
  );
}

// ── Text handler: receive the tag to block ─────────────────────────────────

export async function handleTagInput(ctx: Context, tag: string): Promise<void> {
  const userId = ctx.from!.id;

  // Validate
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
      `⚠️ Tag must only contain letters, numbers, and underscores after <code>#</code>`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  // Add to blocked tags list
  const setting  = await Setting.findOne({ key: SETTING_KEYS.BLOCKED_TAGS }).lean();
  const existing = setting?.value
    ? setting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  if (existing.includes(cleaned)) {
    clearSession(userId);
    await ctx.reply(
      `ℹ️ Tag <code>${esc(cleaned)}</code> is already blocked.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const updated = [...existing, cleaned].join(',');
  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.BLOCKED_TAGS },
    { $set: { value: updated, updatedBy: userId } },
    { upsert: true }
  );

  // Remove all indexed messages that contain this tag in their caption
  const result = await ChannelMessage.deleteMany({
    caption: { $regex: cleaned, $options: 'i' },
  });

  cacheService.invalidate();
  clearSession(userId);

  logger.info(`Admin ${userId} blocked tag "${cleaned}", removed ${result.deletedCount} indexed files`);

  await ctx.reply(
    `✅ <b>Tag blocked successfully!</b>\n\n` +
    `🏷️ Tag: <code>${esc(cleaned)}</code>\n` +
    `🗑️ Removed from index: <b>${result.deletedCount}</b> file(s)\n\n` +
    `Going forward, any file with <code>${esc(cleaned)}</code> in its caption will be automatically skipped during indexing.`,
    { parse_mode: 'HTML' }
  );
}

// ── Text handler: receive forwarded message to unindex ─────────────────────

export async function handleForwardedUnindex(ctx: Context): Promise<void> {
  const msg     = ctx.message as any;
  const userId  = ctx.from!.id;

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

  const existing = await ChannelMessage.findOne({ channelId, messageId }, 'fileName').lean();

  if (!existing) {
    clearSession(userId);
    await ctx.reply(
      `ℹ️ <b>File not in index</b>\n\n` +
      `Message ID <code>${messageId}</code> from channel <code>${esc(channelId)}</code> is not currently indexed — nothing to remove.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  await ChannelMessage.deleteOne({ channelId, messageId });
  cacheService.invalidate();
  clearSession(userId);

  logger.info(`Admin ${userId} unindexed ${channelId}/${messageId} ("${existing.fileName}")`);

  await ctx.reply(
    `✅ <b>File removed from index!</b>\n\n` +
    `📁 <b>${esc(existing.fileName)}</b>\n` +
    `📡 Channel: <code>${esc(channelId)}</code>\n` +
    `🔢 Message ID: ${messageId}\n\n` +
    `This file will no longer appear in search results.\n` +
    `<i>Note: If you re-run /backfill, it will be skipped because it's no longer in the index. However, if you run a full "Delete All Data" reset, it could be re-indexed. To permanently prevent it, also add a blocking tag to its caption in the channel.</i>`,
    { parse_mode: 'HTML' }
  );
}

// ── Remove a blocked tag ───────────────────────────────────────────────────

export async function handleRemoveBlockedTag(
  ctx: Context,
  tag: string
): Promise<void> {
  await ctx.answerCbQuery();
  const userId = ctx.from!.id;

  const setting  = await Setting.findOne({ key: SETTING_KEYS.BLOCKED_TAGS }).lean();
  const existing = setting?.value
    ? setting.value.split(',').map((t) => t.trim()).filter(Boolean)
    : [];

  const updated = existing.filter((t) => t !== tag);
  await Setting.findOneAndUpdate(
    { key: SETTING_KEYS.BLOCKED_TAGS },
    { $set: { value: updated.join(','), updatedBy: userId } },
    { upsert: true }
  );

  logger.info(`Admin ${userId} unblocked tag "${tag}"`);

  const remaining = updated.length > 0
    ? updated.map((t) => `• <code>${esc(t)}</code>`).join('\n')
    : '<i>None</i>';

  await ctx.editMessageText(
    `✅ <b>Tag unblocked:</b> <code>${esc(tag)}</code>\n\n` +
    `Files with this tag will be indexed again on next /backfill or new post.\n\n` +
    `<b>Remaining blocked tags:</b>\n${remaining}`,
    {
      parse_mode: 'HTML',
      reply_markup: { inline_keyboard: [[{ text: '⬅️ Back to Unindex', callback_data: 'unindex:back' }]] },
    }
  );
}
