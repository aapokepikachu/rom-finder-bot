import { Context } from 'telegraf';
import { Channel } from '../models/Channel';
import { ChannelMessage } from '../models/ChannelMessage';
import { cacheService } from '../services/cache';
import { extractCategory, buildCleanName, buildCleanCaption, isFallbackFileName } from '../utils/helpers';
import { captionHasBlockedTag } from '../utils/blockedTags';
import { config } from '../config';
import { logger } from '../utils/logger';

export async function channelPostHandler(ctx: Context): Promise<void> {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id.toString();

  const isTracked =
    config.CHANNELS.includes(chatId) ||
    (await Channel.exists({ channelId: chatId }));

  if (!isTracked) return;

  const doc     = (post as any).document;
  const video   = (post as any).video;
  const audio   = (post as any).audio;
  const fileObj = doc || video || audio;
  if (!fileObj) return;

  const caption: string = (post as any).caption || '';

  // Skip files with blocked tags in caption
  if (await captionHasBlockedTag(caption)) {
    logger.debug(`Skipping post ${post.message_id} in ${chatId} — blocked tag in caption`);
    return;
  }

  const rawName  = fileObj.file_name || extractFileNameFromCaption(caption) || `file_${post.message_id}`;
  const fileSize: number | undefined = fileObj.file_size;
  const fileId: string = fileObj.file_id;

  // Skip photo/audio posts with no real filename — they pollute search results
  if (isFallbackFileName(rawName)) {
    logger.debug(`Skipping post ${post.message_id} in ${chatId} — no real filename`);
    return;
  }

  const fileName = rawName;
  const cleanName    = buildCleanName(rawName);
  const cleanCaption  = buildCleanCaption(caption);

  const channelMapping = await Channel.findOne({ channelId: chatId }, 'label').lean();
  const category = channelMapping?.label || extractCategory(caption);

  try {
    await ChannelMessage.findOneAndUpdate(
      { channelId: chatId, messageId: post.message_id },
      { $set: { fileName, cleanName, caption, cleanCaption, category, fileSize, fileId, receivedAt: new Date() } },
      { upsert: true }
    );
    if (category) cacheService.invalidate(category.toLowerCase());
    logger.debug(`Indexed ${post.message_id} from ${chatId} (${fileName})`);
  } catch (error: any) {
    if (error.code !== 11000) logger.error('Error indexing channel message:', error);
  }
}

export async function editedChannelPostHandler(ctx: Context): Promise<void> {
  const post = ctx.editedChannelPost;
  if (!post) return;

  const chatId      = post.chat.id.toString();
  const newCaption  = (post as any).caption || '';

  if (!newCaption) return;

  // If edited caption now contains a blocked tag — remove from index
  if (await captionHasBlockedTag(newCaption)) {
    await ChannelMessage.deleteOne({ channelId: chatId, messageId: post.message_id });
    cacheService.invalidate();
    logger.debug(`Removed ${post.message_id} from ${chatId} after edit added blocked tag`);
    return;
  }

  try {
    await ChannelMessage.findOneAndUpdate(
      { channelId: chatId, messageId: post.message_id },
      { $set: { caption: newCaption } }
    );
    cacheService.invalidate();
  } catch (error) {
    logger.warn(`Failed to update indexed message ${post.message_id}:`, error);
  }
}

function extractFileNameFromCaption(caption: string): string | undefined {
  const match = caption.match(
    /([^\n\s]+\.(zip|7z|rar|rom|iso|nds|gba|3ds|cso|elf|bin|sfc|smc|gb|gbc|n64|z64|v64))/i
  );
  return match?.[1];
}
