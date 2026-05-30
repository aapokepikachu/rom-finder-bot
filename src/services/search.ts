import { Telegraf } from 'telegraf';
import Fuse from 'fuse.js';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { ChannelMessage } from '../models/ChannelMessage';
import { SearchFeedback } from '../models/SearchFeedback';
import { FailedSearch } from '../models/FailedSearch';
import { cacheService, SearchResult, CachedResult } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { normalizeQuery, buildMessageLink } from '../utils/helpers';

export interface SearchOptions {
  query:          string;
  /**
   * How to scope the search:
   *   undefined        → search all channels
   *   "tag::#emulator" → filter by caption tag across all channels
   *   "-100xxxx"       → filter to one specific channel ID
   */
  category?:      string;
  categoryLabel?: string;   // human-readable label for failed-search logging
  userId:         number;
}

export interface SearchResponse {
  bestMatch:         SearchResult | null;
  otherMatches:      SearchResult[];
  fromCache:         boolean;
  suggestions:       string[];
  didYouMean:        string[];   // close-but-below-threshold file name suggestions
  categoryMissRate:  number;     // 0–1: fraction of ❌ votes for this category+query
}

interface IndexedMessage {
  messageId: number;
  fileName:  string;
  caption:   string;
  category?: string;
  fileSize?: number;
}

interface MessageIndex {
  channelId: string;
  messages:  IndexedMessage[];
  indexedAt: number;
}

const messageIndexes = new Map<string, MessageIndex>();
const INDEX_TTL = 30 * 60 * 1000;

// Feedback decay: votes older than DECAY_HALF_LIFE_DAYS have half the weight
const DECAY_HALF_LIFE_DAYS = 30;

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
    const { query, category, categoryLabel, userId } = options;
    const normalized  = normalizeQuery(query);
    const cacheKey    = category || 'ALL';
    const labelForLog = categoryLabel || (category ? category : 'All');

    // ── Cache check ──────────────────────────────────────────────────────
    const cached = cacheService.get(normalized, cacheKey);
    if (cached) {
      logger.debug(`Cache HIT query="${normalized}" scope="${cacheKey}"`);
      await this.recordSearch(query, normalized);
      // Still compute category miss rate even on cache hits (cheap aggregation)
      const categoryMissRate = await this.getCategoryMissRate(normalized, cacheKey);
      return { ...cached, fromCache: true, suggestions: [], didYouMean: [], categoryMissRate };
    }

    // ── Load candidate messages ──────────────────────────────────────────
    let allMessages: (IndexedMessage & { channelId: string })[] = [];

    if (category && isTagCategory(category)) {
      const tag        = extractTag(category);
      const channelIds = await this.getAllChannelIds();
      for (const channelId of channelIds) {
        const msgs = await this.getChannelMessages(channelId);
        msgs
          .filter((m) => m.caption.toLowerCase().includes(tag.toLowerCase()))
          .forEach((m) => allMessages.push({ ...m, channelId }));
      }
    } else if (category) {
      const msgs = await this.getChannelMessages(category);
      msgs.forEach((m) => allMessages.push({ ...m, channelId: category }));
    } else {
      const channelIds = await this.getAllChannelIds();
      for (const channelId of channelIds) {
        const msgs = await this.getChannelMessages(channelId);
        msgs.forEach((m) => allMessages.push({ ...m, channelId }));
      }
    }

    logger.debug(`Search "${normalized}": ${allMessages.length} candidates, scope="${cacheKey}"`);

    if (allMessages.length === 0) {
      await Promise.all([
        this.recordSearch(query, normalized),
        this.recordFailedSearch(query, normalized, cacheKey, labelForLog),
      ]);
      return {
        bestMatch:        null,
        otherMatches:     [],
        fromCache:        false,
        suggestions:      this.generateSuggestions(query),
        didYouMean:       [],
        categoryMissRate: 0,
      };
    }

    // ── Fuse.js fuzzy search (primary threshold) ─────────────────────────
    const fuse = new Fuse(allMessages, {
      keys: [
        { name: 'fileName', weight: 0.65 },
        { name: 'caption',  weight: 0.35 },
      ],
      includeScore:       true,
      threshold:          0.55,
      minMatchCharLength: 2,
      ignoreLocation:     true,
    });

    const fuseResults = fuse.search(normalized);

    // ── "Did you mean X?" — wider threshold pass when main search fails ──
    // Run a separate pass at a looser threshold to surface near-misses.
    // These are never shown as results, only as "did you mean?" hints.
    let didYouMean: string[] = [];
    if (fuseResults.length === 0) {
      const looseFuse = new Fuse(allMessages, {
        keys: [
          { name: 'fileName', weight: 0.65 },
          { name: 'caption',  weight: 0.35 },
        ],
        includeScore:       true,
        threshold:          0.75,   // much looser — picks up close-ish names
        minMatchCharLength: 2,
        ignoreLocation:     true,
      });
      const looseResults = looseFuse.search(normalized);
      didYouMean = [...new Set(
        looseResults
          .slice(0, 5)
          .map((r) => r.item.fileName)
          .filter((name) => name && name.length > 0)
      )].slice(0, 3);
    }

    if (fuseResults.length === 0) {
      await Promise.all([
        this.recordSearch(query, normalized),
        this.recordFailedSearch(query, normalized, cacheKey, labelForLog),
      ]);
      return {
        bestMatch:        null,
        otherMatches:     [],
        fromCache:        false,
        suggestions:      this.generateSuggestions(query),
        didYouMean,
        categoryMissRate: 0,
      };
    }

    // ── Apply decay-weighted feedback boosts ─────────────────────────────
    const feedbackBoosts = await this.getFeedbackBoosts(normalized);
    const categoryMissRate = await this.getCategoryMissRate(normalized, cacheKey);

    const searchResults: SearchResult[] = fuseResults
      .slice(0, config.MAX_RESULTS)
      .map((r) => {
        const baseScore  = 1 - (r.score ?? 1);
        const boostKey   = `${r.item.channelId}:${r.item.messageId}`;
        const boost      = feedbackBoosts.get(boostKey) ?? 0;
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

    return { ...response, fromCache: false, suggestions: [], didYouMean, categoryMissRate };
  }

  // ── Decay-weighted feedback boosts ─────────────────────────────────────
  /**
   * Computes a score boost per result for a given query.
   * Recent votes count more than old ones via exponential decay.
   * Decay half-life: DECAY_HALF_LIFE_DAYS days.
   * Boost range: -0.10 (all ❌) to +0.15 (all ✅)
   */
  private async getFeedbackBoosts(normalizedQuery: string): Promise<Map<string, number>> {
    const boosts = new Map<string, number>();
    try {
      const votes = await SearchFeedback.find(
        { normalizedQuery },
        'channelId messageId gotIt createdAt'
      ).lean();

      if (votes.length === 0) return boosts;

      const now = Date.now();
      const halfLifeMs = DECAY_HALF_LIFE_DAYS * 24 * 60 * 60 * 1000;

      // Group votes by result, computing decay-weighted sum
      const grouped = new Map<string, { weightedYes: number; weightedTotal: number }>();
      for (const vote of votes) {
        const key     = `${vote.channelId}:${vote.messageId}`;
        const ageMs   = now - new Date(vote.createdAt).getTime();
        const weight  = Math.pow(0.5, ageMs / halfLifeMs);  // exponential decay

        if (!grouped.has(key)) grouped.set(key, { weightedYes: 0, weightedTotal: 0 });
        const g = grouped.get(key)!;
        g.weightedTotal += weight;
        if (vote.gotIt) g.weightedYes += weight;
      }

      for (const [key, { weightedYes, weightedTotal }] of grouped) {
        const ratio = weightedYes / weightedTotal;
        // ratio=1.0 → +0.15, ratio=0.5 → 0.0, ratio=0.0 → -0.10
        const boost = ratio >= 0.5
          ? (ratio - 0.5) * 0.30     // max +0.15
          : (ratio - 0.5) * 0.20;    // max -0.10
        boosts.set(key, boost);
      }
    } catch (err) {
      logger.warn('getFeedbackBoosts error:', err);
    }
    return boosts;
  }

  // ── Category miss-rate ──────────────────────────────────────────────────
  /**
   * Returns the fraction of ❌ votes for this query+category combination.
   * Used to suggest "try a different category?" in the UI.
   */
  async getCategoryMissRate(normalizedQuery: string, category: string): Promise<number> {
    try {
      const { CategoryFeedback } = await import('../models/CategoryFeedback');
      const agg = await CategoryFeedback.aggregate([
        { $match: { normalizedQuery, category } },
        {
          $group: {
            _id:      null,
            total:    { $sum: 1 },
            misses:   { $sum: { $cond: [{ $eq: ['$helpful', false] }, 1, 0] } },
          },
        },
      ]);
      if (!agg[0] || agg[0].total < 3) return 0;  // need at least 3 votes to be meaningful
      return agg[0].misses / agg[0].total;
    } catch (err) {
      logger.warn('getCategoryMissRate error:', err);
      return 0;
    }
  }

  // ── Record failed search ────────────────────────────────────────────────
  private async recordFailedSearch(
    original:      string,
    normalized:    string,
    category:      string,
    categoryLabel: string
  ): Promise<void> {
    try {
      await FailedSearch.findOneAndUpdate(
        { normalizedQuery: normalized, category },
        {
          $inc: { count: 1 },
          $set: { query: original, categoryLabel, lastFailedAt: new Date() },
        },
        { upsert: true }
      );
    } catch (err) {
      logger.warn('Failed to record failed search:', err);
    }
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
