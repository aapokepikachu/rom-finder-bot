import { Telegraf } from 'telegraf';
import Fuse from 'fuse.js';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { ChannelMessage } from '../models/ChannelMessage';
import { cacheService, SearchResult, CachedResult } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { normalizeQuery, buildMessageLink, extractCategory } from '../utils/helpers';

export interface SearchOptions {
  query: string;
  category?: string;   // a channelId when searching specific channel, or undefined = all
  userId: number;
}

export interface SearchResponse {
  bestMatch: SearchResult | null;
  otherMatches: SearchResult[];
  fromCache: boolean;
  suggestions: string[];
}

interface MessageIndex {
  channelId: string;
  messages: IndexedMessage[];
  indexedAt: number;
}

interface IndexedMessage {
  messageId: number;
  fileName: string;
  caption: string;
  category?: string;
  fileSize?: number;
}

const messageIndexes = new Map<string, MessageIndex>();
const INDEX_TTL = 30 * 60 * 1000; // 30 minutes

export class SearchService {
  private bot: Telegraf;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const { query, category, userId } = options;
    const normalized = normalizeQuery(query);
    const cacheKey = category || 'ALL';

    // Cache check
    const cached = cacheService.get(normalized, cacheKey);
    if (cached) {
      logger.debug(`Cache HIT query="${normalized}" channel="${cacheKey}"`);
      await this.recordSearch(query, normalized);
      return { ...cached, fromCache: true, suggestions: [] };
    }

    // Determine channels to search
    const channelsToSearch = category
      ? [category]  // specific channel ID
      : await this.getAllChannelIds();

    if (channelsToSearch.length === 0) {
      return {
        bestMatch: null,
        otherMatches: [],
        fromCache: false,
        suggestions: ['No channels configured yet. Ask the admin to map channels.'],
      };
    }

    // Gather all messages
    const allMessages: (IndexedMessage & { channelId: string })[] = [];
    for (const channelId of channelsToSearch) {
      const msgs = await this.getChannelMessages(channelId);
      msgs.forEach((m) => allMessages.push({ ...m, channelId }));
    }

    logger.debug(`Search "${normalized}": ${allMessages.length} total messages across ${channelsToSearch.length} channels`);

    if (allMessages.length === 0) {
      await this.recordSearch(query, normalized);
      return {
        bestMatch: null,
        otherMatches: [],
        fromCache: false,
        suggestions: this.generateSuggestions(query),
      };
    }

    // Fuse.js fuzzy search
    const fuse = new Fuse(allMessages, {
      keys: [
        { name: 'fileName', weight: 0.6 },
        { name: 'caption',  weight: 0.4 },
      ],
      includeScore: true,
      threshold: 0.55,
      minMatchCharLength: 2,
      ignoreLocation: true,
      useExtendedSearch: false,
    });

    const results = fuse.search(normalized);

    if (results.length === 0) {
      await this.recordSearch(query, normalized);
      return {
        bestMatch: null,
        otherMatches: [],
        fromCache: false,
        suggestions: this.generateSuggestions(query),
      };
    }

    const searchResults: SearchResult[] = results
      .slice(0, config.MAX_RESULTS)
      .map((r) => ({
        channelId: r.item.channelId,
        messageId: r.item.messageId,
        fileName: r.item.fileName,
        caption: r.item.caption,
        category: r.item.category,
        fileSize: r.item.fileSize,
        score: 1 - (r.score ?? 1),
        messageLink: buildMessageLink(r.item.channelId, r.item.messageId),
      }));

    const response: CachedResult = {
      bestMatch: searchResults[0],
      otherMatches: searchResults.slice(1),
      query: normalized,
      category: cacheKey,
      cachedAt: Date.now(),
    };

    cacheService.set(normalized, cacheKey, response);
    await this.recordSearch(query, normalized);

    return { ...response, fromCache: false, suggestions: [] };
  }

  private async getAllChannelIds(): Promise<string[]> {
    // Union of ENV channels + DB-mapped channels
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
    logger.debug(`Loaded ${messages.length} messages for channel ${channelId} from DB`);
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
        {
          $inc: { count: 1 },
          $set: { query: original, lastSearchedAt: new Date() },
        },
        { upsert: true }
      );
    } catch (err) {
      logger.warn('Failed to record search:', err);
    }
  }

  private generateSuggestions(query: string): string[] {
    const s: string[] = [];
    if (query.length < 3) s.push('Try a longer search term (at least 3 characters)');
    if (query.includes('.')) s.push(`Try without file extension: "${query.replace(/\.[^.]+$/, '')}"`);
    if (query.split(' ').length === 1) s.push('Try adding more words from the full title');
    s.push('Check the spelling and try again');
    return s.slice(0, 3);
  }

  clearIndex(channelId?: string): void {
    if (channelId) messageIndexes.delete(channelId);
    else messageIndexes.clear();
  }

  getIndexStats(): { channelId: string; messageCount: number; age: string }[] {
    const now = Date.now();
    return [...messageIndexes.entries()].map(([id, idx]) => ({
      channelId: id,
      messageCount: idx.messages.length,
      age: `${Math.floor((now - idx.indexedAt) / 60000)}m ago`,
    }));
  }
}
