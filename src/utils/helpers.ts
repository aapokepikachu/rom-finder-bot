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

// ── Clean name utilities ──────────────────────────────────────────────────────

/**
 * Produces a clean, human-readable display name from a raw filename.
 * Handles patterns like:
 *   "@PokemonNdsGba_1606_Pokemon_Sun_Europe_En,Ja,Fr.3ds" → "Pokemon Sun Europe"
 *   "Pokemon_Black_Version_DSi_Enhanced_USA_E_@PokemonNdsGba.zip" → "Pokemon Black Version DSi Enhanced USA E"
 *   "Super_Mario_64_(U)[!].z64" → "Super Mario 64 (U)[!]"
 */
export function cleanDisplayName(raw: string): string {
  return raw
    // Strip leading @Channel_digits_ prefix (e.g. @PokemonNdsGba_1606_)
    .replace(/^@[A-Za-z0-9_]+_\d+_/g, '')
    // Strip any remaining @handles (mid or trailing)
    .replace(/@[A-Za-z0-9_]+/g, '')
    // Strip file extension
    .replace(/\.[a-zA-Z0-9]{1,5}$/, '')
    // Convert underscores to spaces
    .replace(/_/g, ' ')
    // Strip comma-separated 2–3 letter language/region codes (e.g. ",Ja,Fr,De,Es")
    .replace(/(?:,[A-Z][a-z]{0,2}){2,}/g, '')
    // Collapse multiple spaces/commas left over
    .replace(/[,]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Produces a normalised string for Fuse.js indexing.
 * Strips @handles, extensions, language codes, and lowercases.
 * Stored as `cleanName` in MongoDB; searched instead of raw `fileName`.
 */
export function buildCleanName(raw: string): string {
  return cleanDisplayName(raw).toLowerCase();
}

/**
 * Cleans a caption for Fuse.js indexing.
 * Strips emojis, variation selectors, ratings (4.5 ⭐), @handles, URLs, hashtags.
 * Returns only the meaningful game/file title text.
 *
 * Example:
 *   "Pokemon Sun  4.5 ️️️️  PokemonROM  #3ds  @PokemonNdsGba"
 *     → "Pokemon Sun PokemonROM"
 */
export function buildCleanCaption(caption: string): string {
  return caption
    .replace(/[\uFE00-\uFE0F]/g, '')              // variation selectors (️)
    .replace(/[\u2600-\u27BF]/g, '')              // misc symbols & dingbats
    .replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '') // surrogate-pair emoji
    .replace(/\d+\.\d+\s*/g, '')                 // ratings like "4.5 "
    .replace(/@[A-Za-z0-9_]+/g, '')                // @handles
    .replace(/https?:\/\/\S+/g, '')              // URLs
    .replace(/#[A-Za-z0-9_]+/g, '')                // hashtags (kept in caption field separately)
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Returns true if the filename looks like an auto-generated fallback
 * (e.g. "file_71" or "file_-1001234_71") — these are photos or files
 * with no real name and should be excluded from search results.
 */
export function isFallbackFileName(name: string): boolean {
  return /^file_[\d_\-]+$/.test(name.trim());
}

/**
 * Parses region/version tags from a filename or caption.
 * Returns an array of short badges like ["USA", "v1.4.1", "DSi Enhanced"]
 */
export function parseFileTags(text: string): string[] {
  const tags: string[] = [];

  // Region codes: (USA), (U), (J), (E), (EUR), (JPN), etc.
  const regionMatch = text.match(/\(([A-Z]{1,3})\)/g);
  if (regionMatch) {
    regionMatch.forEach((m) => {
      const code = m.replace(/[()]/g, '');
      const MAP: Record<string, string> = {
        U: 'USA', USA: 'USA', E: 'EUR', EUR: 'EUR',
        J: 'JPN', JPN: 'JPN', W: 'World',
      };
      tags.push(MAP[code] || code);
    });
  }

  // Version numbers: v1.4.1, v2, V3.0
  const verMatch = text.match(/[Vv]\d+(\.\d+)*/g);
  if (verMatch) tags.push(...verMatch.map((v) => v.toLowerCase()));

  // Known descriptor words in filename
  const DESCRIPTORS = [
    'Enhanced', 'Complete', 'Completed', 'Redux', 'Classic',
    'EVless', 'DSi', 'Hack', 'ROM Hack', 'Remaster',
  ];
  for (const d of DESCRIPTORS) {
    if (new RegExp(`\\b${d}\\b`, 'i').test(text)) tags.push(d);
  }

  // Deduplicate preserving order
  return [...new Set(tags)].slice(0, 4);
}
