import { Telegraf } from 'telegraf';
import Fuse from 'fuse.js';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { ChannelMessage } from '../models/ChannelMessage';
import { SearchFeedback } from '../models/SearchFeedback';
import { cacheService, SearchResult, CachedResult } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { normalizeQuery, buildMessageLink } from '../utils/helpers';

export interface SearchOptions {
  query:    string;
  /**
   * How to scope the search:
   *   undefined        → search all channels
   *   "tag::#emulator" → filter by caption tag across all channels
   *   "-100xxxx"       → filter to one specific channel ID
   */
  category?: string;
  userId:   number;
}

export interface SearchResponse {
  bestMatch:    SearchResult | null;
  otherMatches: SearchResult[];
  fromCache:    boolean;
  suggestions:  string[];
}

interface IndexedMessage {
  messageId: number;
  fileName:  string;
  caption:   string;
  category?: string;
  fileSize?: number;
}

interface MessageIndex {
  channelId:  string;
  messages:   IndexedMessage[];
  indexedAt:  number;
}

const messageIndexes = new Map<string, MessageIndex>();
const INDEX_TTL = 30 * 60 * 1000;

/** Prefix used to distinguish tag-based categories from channel IDs */
export const TAG_CATEGORY_PREFIX = 'tag::';

export function isTagCategory(category: string): boolean {
  return category.startsWith(TAG_CATEGORY_PREFIX);
}

export function extractTag(category: string): string {
  return category.slice(TAG_CATEGORY_PREFIX.length);
}

export class SearchService {
  private bot: Telegraf;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const { query, category, userId } = options;
    const normalized = normalizeQuery(query);
    const cacheKey   = category || 'ALL';

    // Cache check
    const cached = cacheService.get(normalized, cacheKey);
    if (cached) {
      logger.debug(`Cache HIT query="${normalized}" scope="${cacheKey}"`);
      await this.recordSearch(query, normalized);
      return { ...cached, fromCache: true, suggestions: [] };
    }

    // Load candidate messages
    let allMessages: (IndexedMessage & { channelId: string })[] = [];

    if (category && isTagCategory(category)) {
      // Tag-based: load all channels, then filter by tag in caption
      const tag = extractTag(category);
      const channelIds = await this.getAllChannelIds();
      for (const channelId of channelIds) {
        const msgs = await this.getChannelMessages(channelId);
        msgs
          .filter((m) => m.caption.toLowerCase().includes(tag.toLowerCase()))
          .forEach((m) => allMessages.push({ ...m, channelId }));
      }
      logger.debug(`Tag search "${tag}": ${allMessages.length} matching messages`);
    } else if (category) {
      // Channel-based: only load that specific channel
      const msgs = await this.getChannelMessages(category);
      msgs.forEach((m) => allMessages.push({ ...m, channelId: category }));
    } else {
      // Global: load all channels
      const channelIds = await this.getAllChannelIds();
      for (const channelId of channelIds) {
        const msgs = await this.getChannelMessages(channelId);
        msgs.forEach((m) => allMessages.push({ ...m, channelId }));
      }
    }

    logger.debug(`Search "${normalized}": ${allMessages.length} candidates, scope="${cacheKey}"`);

    if (allMessages.length === 0) {
      await this.recordSearch(query, normalized);
      return {
        bestMatch:    null,
        otherMatches: [],
        fromCache:    false,
        suggestions:  this.generateSuggestions(query),
      };
    }

    // Fuse.js fuzzy search
    const fuse = new Fuse(allMessages, {
      keys: [
        { name: 'fileName', weight: 0.65 },
        { name: 'caption',  weight: 0.35 },
      ],
      includeScore:    true,
      threshold:       0.55,
      minMatchCharLength: 2,
      ignoreLocation:  true,
    });

    const fuseResults = fuse.search(normalized);

    if (fuseResults.length === 0) {
      await this.recordSearch(query, normalized);
      return {
        bestMatch:    null,
        otherMatches: [],
        fromCache:    false,
        suggestions:  this.generateSuggestions(query),
      };
    }

    // Apply feedback boost scores
    const feedbackBoosts = await this.getFeedbackBoosts(normalized);

    const searchResults: SearchResult[] = fuseResults
      .slice(0, config.MAX_RESULTS)
      .map((r) => {
        const baseScore = 1 - (r.score ?? 1);
        const boostKey  = `${r.item.channelId}:${r.item.messageId}`;
        const boost     = feedbackBoosts.get(boostKey) ?? 0;
        const finalScore = Math.min(1, Math.max(0, baseScore + boost));
        return {
          channelId:   r.item.channelId,
          messageId:   r.item.messageId,
          fileName:    r.item.fileName,
          caption:     r.item.caption,
          category:    r.item.category,
          fileSize:    r.item.fileSize,
          score:       finalScore,
          messageLink: buildMessageLink(r.item.channelId, r.item.messageId),
        };
      })
      .sort((a, b) => b.score - a.score);

    const response: CachedResult = {
      bestMatch:    searchResults[0],
      otherMatches: searchResults.slice(1),
      query:        normalized,
      category:     cacheKey,
      cachedAt:     Date.now(),
    };

    cacheService.set(normalized, cacheKey, response);
    await this.recordSearch(query, normalized);

    return { ...response, fromCache: false, suggestions: [] };
  }

  private async getFeedbackBoosts(normalizedQuery: string): Promise<Map<string, number>> {
    const boosts = new Map<string, number>();
    try {
      const agg = await SearchFeedback.aggregate([
        { $match: { normalizedQuery } },
        {
          $group: {
            _id:           { channelId: '$channelId', messageId: '$messageId' },
            gotItCount:    { $sum: { $cond: ['$gotIt', 1, 0] } },
            total:         { $sum: 1 },
          },
        },
      ]);
      for (const row of agg) {
        const ratio = row.gotItCount / row.total;
        const boost = (ratio - 0.5) * 0.30;
        boosts.set(`${row._id.channelId}:${row._id.messageId}`, boost);
      }
    } catch (err) {
      logger.warn('getFeedbackBoosts error:', err);
    }
    return boosts;
  }

  private async getAllChannelIds(): Promise<string[]> {
    const dbChannels = await Channel.find({}, 'channelId').lean();
    const combined = new Set([
      ...config.CHANNELS,
      ...dbChannels.map((c) => c.channelId),
    ]);
    return [...combined];
  }

  private async getChannelMessages(channelId: string): Promise<IndexedMessage[]> {
    const existing = messageIndexes.get(channelId);
    if (existing && Date.now() - existing.indexedAt < INDEX_TTL) {
      return existing.messages;
    }
    const messages = await this.loadFromDB(channelId);
    messageIndexes.set(channelId, { channelId, messages, indexedAt: Date.now() });
    logger.debug(`Loaded ${messages.length} messages for channel ${channelId}`);
    return messages;
  }

  private async loadFromDB(channelId: string): Promise<IndexedMessage[]> {
    const docs = await ChannelMessage.find(
      { channelId },
      'messageId fileName caption category fileSize'
    ).lean();
    return docs.map((d) => ({
      messageId: d.messageId,
      fileName:  d.fileName,
      caption:   d.caption,
      category:  d.category,
      fileSize:  d.fileSize,
    }));
  }

  private async recordSearch(original: string, normalized: string): Promise<void> {
    try {
      await Search.findOneAndUpdate(
        { normalizedQuery: normalized },
        { $inc: { count: 1 }, $set: { query: original, lastSearchedAt: new Date() } },
        { upsert: true }
      );
    } catch (err) {
      logger.warn('Failed to record search:', err);
    }
  }

  private generateSuggestions(query: string): string[] {
    const s: string[] = [];
    if (query.length < 3)              s.push('Try a longer search term (at least 3 characters)');
    if (query.includes('.'))           s.push(`Try without file extension: "${query.replace(/\.[^.]+$/, '')}"`);
    if (query.split(' ').length === 1) s.push('Try adding more words from the full title');
    s.push('Check the spelling and try again');
    return s.slice(0, 3);
  }

  clearIndex(channelId?: string): void {
    if (channelId) messageIndexes.delete(channelId);
    else           messageIndexes.clear();
  }

  getIndexStats() {
    const now = Date.now();
    return [...messageIndexes.entries()].map(([id, idx]) => ({
      channelId:    id,
      messageCount: idx.messages.length,
      age:          `${Math.floor((now - idx.indexedAt) / 60000)}m ago`,
    }));
  }
}
