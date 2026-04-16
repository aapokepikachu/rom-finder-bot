import { CATEGORIES, Category } from '../config';

/**
 * Normalize a search query: lowercase, trim, collapse whitespace
 */
export function normalizeQuery(query: string): string {
  return query.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Extract category from caption hashtags like #GBA, #Nds, #3ds
 */
export function extractCategory(caption: string): Category | undefined {
  const tagPattern = /#([a-zA-Z0-9]+)/g;
  let match;

  while ((match = tagPattern.exec(caption)) !== null) {
    const tag = match[1].toUpperCase();
    if (CATEGORIES.includes(tag as Category)) {
      return tag as Category;
    }
  }
  return undefined;
}

/**
 * Build a public Telegram message link
 */
export function buildMessageLink(channelId: string, messageId: number): string {
  // channelId is like -1001234567890
  // Public link format: https://t.me/c/1234567890/messageId
  const numericId = channelId.replace('-100', '');
  return `https://t.me/c/${numericId}/${messageId}`;
}

/**
 * Sanitize text for Telegram MarkdownV2
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, '\\$&');
}

/**
 * Truncate text to max length with ellipsis
 */
export function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength - 3) + '...';
}

/**
 * Extract file name from a Telegram document/audio/video
 */
export function extractFileName(ctx: any): string {
  const msg = ctx.message || ctx.channelPost;
  if (!msg) return 'unknown';

  const doc = msg.document || msg.video || msg.audio;
  if (doc?.file_name) return doc.file_name;
  if (msg.caption) {
    // Try to extract a file-like name from caption
    const match = msg.caption.match(/([^\n]+\.(zip|7z|rar|rom|iso|nds|gba|3ds|cso|elf))/i);
    if (match) return match[1];
  }
  return `file_${msg.message_id}`;
}

/**
 * Format file size for display
 */
export function formatFileSize(bytes?: number): string {
  if (!bytes) return 'Unknown size';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Format a date to a readable string
 */
export function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Check if a string is a valid channel ID
 */
export function isValidChannelId(id: string): boolean {
  return /^-100\d{10,}$/.test(id);
}

/**
 * Parse inline state data safely
 */
export function parseCallbackData(data: string): { action: string; payload: string } {
  const [action, ...rest] = data.split(':');
  return { action: action || '', payload: rest.join(':') };
}

/**
 * Chunk an array into groups of N
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

/**
 * Sleep for N milliseconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
