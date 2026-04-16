import { Telegraf } from 'telegraf';
import Fuse from 'fuse.js';
import { Channel } from '../models/Channel';
import { Search } from '../models/Search';
import { cacheService, SearchResult, CachedResult } from './cache';
import { config } from '../config';
import { logger } from '../utils/logger';
import { extractCategory, normalizeQuery, buildMessageLink } from '../utils/helpers';

export interface SearchOptions {
  query: string;
  category?: string;
  userId: number;
}

export interface SearchResponse {
  bestMatch: SearchResult | null;
  otherMatches: SearchResult[];
  fromCache: boolean;
  suggestions: string[];
}

// In-memory message index per channel (refreshed on demand)
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

const messageIndexes: Map<string, MessageIndex> = new Map();
const INDEX_TTL = 30 * 60 * 1000; // 30 minutes

export class SearchService {
  private bot: Telegraf;

  constructor(bot: Telegraf) {
    this.bot = bot;
  }

  async search(options: SearchOptions): Promise<SearchResponse> {
    const { query, category, userId } = options;
    const normalized = normalizeQuery(query);

    // Check cache first
    const cached = cacheService.get(normalized, category);
    if (cached) {
      logger.debug(`Cache HIT for query="${normalized}" category="${category}"`);
      await this.recordSearch(query, normalized);
      return { ...cached, fromCache: true, suggestions: [] };
    }

    // Determine which channels to search
    const channelsToSearch = await this.getChannelsToSearch(category);

    if (channelsToSearch.length === 0) {
      return {
        bestMatch: null,
        otherMatches: [],
        fromCache: false,
        suggestions: ['No channels configured for this category yet.'],
      };
    }

    // Gather messages from all relevant channels
    const allMessages: (IndexedMessage & { channelId: string })[] = [];

    for (const channelId of channelsToSearch) {
      const messages = await this.getChannelMessages(channelId);
      messages.forEach((m) =>
        allMessages.push({ ...m, channelId })
      );
    }

    if (allMessages.length === 0) {
      return {
        bestMatch: null,
        otherMatches: [],
        fromCache: false,
        suggestions: this.generateSuggestions(query),
      };
    }

    // Fuzzy search with Fuse.js
    const fuse = new Fuse(allMessages, {
      keys: [
        { name: 'fileName', weight: 0.6 },
        { name: 'caption', weight: 0.4 },
      ],
      includeScore: true,
      threshold: 0.5,
      minMatchCharLength: 2,
      ignoreLocation: true,
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
      category,
      cachedAt: Date.now(),
    };

    cacheService.set(normalized, category, response);
    await this.recordSearch(query, normalized);

    return { ...response, fromCache: false, suggestions: [] };
  }

  private async getChannelsToSearch(category?: string): Promise<string[]> {
    if (!category || category === 'ALL') {
      // Return all configured channels
      const allMapped = await Channel.find({}, 'channelId').lean();
      const mappedIds = new Set(allMapped.map((c) => c.channelId));
      // Also include channels from ENV that aren't mapped yet
      const envChannels = config.CHANNELS;
      const combined = new Set([...mappedIds, ...envChannels]);
      return [...combined];
    }

    const channels = await Channel.find({ category }, 'channelId').lean();
    return channels.map((c) => c.channelId);
  }

  private async getChannelMessages(channelId: string): Promise<IndexedMessage[]> {
    const existing = messageIndexes.get(channelId);
    const now = Date.now();

    if (existing && now - existing.indexedAt < INDEX_TTL) {
      return existing.messages;
    }

    // Re-index this channel
    const messages = await this.indexChannel(channelId);
    messageIndexes.set(channelId, {
      channelId,
      messages,
      indexedAt: now,
    });
    return messages;
  }

  private async indexChannel(channelId: string): Promise<IndexedMessage[]> {
    const messages: IndexedMessage[] = [];
    logger.debug(`Indexing channel ${channelId}...`);

    try {
      // We use getMessages by fetching forward from message ID 1
      // In practice for large channels we do paginated fetches
      let lastId = 0;
      let hasMore = true;
      const BATCH_SIZE = 100;

      while (hasMore) {
        try {
          const batch = await this.bot.telegram.callApi('getUpdates' as any, {} as any).catch(() => []);

          // Use forwardMessages approach: fetch history via channel export
          // Telegraf doesn't natively support getHistory, so we use the Bot API's
          // getChatHistory workaround by querying messages in the channel
          // For channels, we copy a message and track IDs
          hasMore = false; // Break after first attempt for safety
        } catch {
          hasMore = false;
        }
      }

      // Alternative: Use forwardFrom tracking from messages the bot receives
      // The bot must be added as admin to index messages
      const storedMessages = await this.fetchStoredMessages(channelId);
      return storedMessages;
    } catch (error) {
      logger.error(`Error indexing channel ${channelId}:`, error);
      return messages;
    }
  }

  private async fetchStoredMessages(channelId: string): Promise<IndexedMessage[]> {
    // This is populated by the channel post handler (see handlers/channel.ts)
    // Messages are stored as they come in via bot updates
    const { ChannelMessage } = await import('../models/ChannelMessage');
    const docs = await ChannelMessage.find(
      { channelId },
      'messageId fileName caption category fileSize'
    ).lean();

    return docs.map((d) => ({
      messageId: d.messageId,
      fileName: d.fileName,
      caption: d.caption,
      category: d.category,
      fileSize: d.fileSize,
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
        { upsert: true, new: true }
      );
    } catch (error) {
      logger.warn('Failed to record search:', error);
    }
  }

  private generateSuggestions(query: string): string[] {
    const suggestions: string[] = [];

    if (query.length < 3) {
      suggestions.push('Try a longer search term (at least 3 characters)');
    }
    if (query.includes('.')) {
      suggestions.push(`Try without file extension: "${query.replace(/\.[^.]+$/, '')}"`);
    }
    if (/^\d+$/.test(query)) {
      suggestions.push('Try including the game title, not just numbers');
    }
    if (query.split(' ').length === 1) {
      suggestions.push('Try adding more words from the title');
    }

    suggestions.push('Check the spelling of the ROM name');
    return suggestions.slice(0, 3);
  }

  clearIndex(channelId?: string): void {
    if (channelId) {
      messageIndexes.delete(channelId);
    } else {
      messageIndexes.clear();
    }
  }

  getIndexStats(): { channelId: string; messageCount: number; age: string }[] {
    const now = Date.now();
    return [...messageIndexes.entries()].map(([channelId, idx]) => ({
      channelId,
      messageCount: idx.messages.length,
      age: `${Math.floor((now - idx.indexedAt) / 60000)}m ago`,
    }));
  }
}
