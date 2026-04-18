/**
 * Cached blocked-tag checker.
 * Tags are stored in the DB as a comma-separated string.
 * We cache them in memory for 30s to avoid a DB hit on every channel post.
 */
import { Setting, SETTING_KEYS } from '../models/Setting';

let cachedTags: string[] | null = null;
let cacheExpiry = 0;
const CACHE_TTL = 30_000;

export async function getBlockedTags(): Promise<string[]> {
  const now = Date.now();
  if (cachedTags !== null && now < cacheExpiry) return cachedTags;

  try {
    const setting = await Setting.findOne({ key: SETTING_KEYS.BLOCKED_TAGS }).lean();
    cachedTags = setting?.value
      ? setting.value.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean)
      : [];
  } catch {
    cachedTags = [];
  }
  cacheExpiry = now + CACHE_TTL;
  return cachedTags;
}

export function invalidateBlockedTagsCache(): void {
  cachedTags = null;
  cacheExpiry = 0;
}

/** Returns true if the caption contains any blocked tag */
export async function captionHasBlockedTag(caption: string): Promise<boolean> {
  if (!caption) return false;
  const tags = await getBlockedTags();
  if (tags.length === 0) return false;
  const lower = caption.toLowerCase();
  return tags.some((tag) => lower.includes(tag));
}
