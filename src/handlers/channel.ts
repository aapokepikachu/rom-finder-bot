import { Context } from 'telegraf';
import { Channel } from '../models/Channel';
import { ChannelMessage } from '../models/ChannelMessage';
import { cacheService } from '../services/cache';
import {
  extractCategory,
  extractFileName,
} from '../utils/helpers';
import { config } from '../config';
import { logger } from '../utils/logger';

/**
 * Handles all posts from channels where the bot is an admin.
 * Indexes file messages for search.
 */
export async function channelPostHandler(ctx: Context): Promise<void> {
  const post = ctx.channelPost;
  if (!post) return;

  const chatId = post.chat.id.toString();

  // Only process channels we're tracking
  const isTracked =
    config.CHANNELS.includes(chatId) ||
    (await Channel.exists({ channelId: chatId }));

  if (!isTracked) return;

  // Only index messages with files
  const doc = (post as any).document;
  const video = (post as any).video;
  const audio = (post as any).audio;
  const fileObj = doc || video || audio;

  if (!fileObj) return; // Skip text-only posts

  const caption: string = (post as any).caption || '';
  const fileName = fileObj.file_name || extractFileNameFromCaption(caption) || `file_${post.message_id}`;
  const fileSize: number | undefined = fileObj.file_size;
  const fileId: string = fileObj.file_id;

  // Detect category from channel mapping or caption tags
  let category: string | undefined;
  const channelMapping = await Channel.findOne({ channelId: chatId }, 'category').lean();
  if (channelMapping) {
    category = channelMapping.category;
  } else {
    category = extractCategory(caption);
  }

  try {
    await ChannelMessage.findOneAndUpdate(
      { channelId: chatId, messageId: post.message_id },
      {
        $set: {
          fileName,
          caption,
          category,
          fileSize,
          fileId,
          receivedAt: new Date(),
        },
      },
      { upsert: true }
    );

    // Invalidate cache for this category since new content arrived
    if (category) {
      cacheService.invalidate(category.toLowerCase());
    }

    logger.debug(
      `Indexed message ${post.message_id} from channel ${chatId} (${fileName})`
    );
  } catch (error: any) {
    // Duplicate key is fine (message already indexed)
    if (error.code !== 11000) {
      logger.error(`Error indexing channel message:`, error);
    }
  }
}

/**
 * Handles edited channel posts - updates the indexed data
 */
export async function editedChannelPostHandler(ctx: Context): Promise<void> {
  const post = ctx.editedChannelPost;
  if (!post) return;

  const chatId = post.chat.id.toString();
  const newCaption: string = (post as any).caption || '';

  if (!newCaption) return;

  try {
    await ChannelMessage.findOneAndUpdate(
      { channelId: chatId, messageId: post.message_id },
      { $set: { caption: newCaption } }
    );
    cacheService.invalidate(); // Full invalidation on edits
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
