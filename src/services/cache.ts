import NodeCache from 'node-cache';
import { config } from '../config';
import { logger } from '../utils/logger';

export interface CachedResult {
  bestMatch: SearchResult | null;
  otherMatches: SearchResult[];
  query: string;
  category?: string;
  cachedAt: number;
}

export interface SearchResult {
  channelId: string;
  messageId: number;
  fileName: string;
  caption: string;
  category?: string;
  fileSize?: number;
  score: number;
  messageLink: string;
}

class CacheService {
  private cache: NodeCache;
  private keyOrder: string[] = []; // For LRU eviction

  constructor() {
    this.cache = new NodeCache({
      stdTTL: config.CACHE_TTL,
      checkperiod: Math.floor(config.CACHE_TTL / 4),
      maxKeys: config.CACHE_MAX_SIZE,
      useClones: false,
    });

    this.cache.on('del', (key: string) => {
      this.keyOrder = this.keyOrder.filter((k) => k !== key);
    });
  }

  private buildKey(query: string, category?: string): string {
    return `search:${category || 'all'}:${query.toLowerCase().trim()}`;
  }

  get(query: string, category?: string): CachedResult | null {
    const key = this.buildKey(query, category);
    const result = this.cache.get<CachedResult>(key);
    if (result) {
      // Move to end (most recently used)
      this.keyOrder = this.keyOrder.filter((k) => k !== key);
      this.keyOrder.push(key);
      return result;
    }
    return null;
  }

  set(query: string, category: string | undefined, data: CachedResult): void {
    const key = this.buildKey(query, category);

    // If at max size, evict least recently used
    if (this.keyOrder.length >= config.CACHE_MAX_SIZE) {
      const lruKey = this.keyOrder.shift();
      if (lruKey) {
        this.cache.del(lruKey);
        logger.debug(`Cache evicted LRU key: ${lruKey}`);
      }
    }

    this.cache.set(key, data);
    this.keyOrder = this.keyOrder.filter((k) => k !== key);
    this.keyOrder.push(key);
  }

  invalidate(pattern?: string): number {
    if (!pattern) {
      const count = this.cache.keys().length;
      this.cache.flushAll();
      this.keyOrder = [];
      return count;
    }

    const keys = this.cache.keys().filter((k) => k.includes(pattern));
    keys.forEach((k) => this.cache.del(k));
    this.keyOrder = this.keyOrder.filter((k) => !keys.includes(k));
    return keys.length;
  }

  getStats() {
    const stats = this.cache.getStats();
    return {
      keys: stats.keys,
      hits: stats.hits,
      misses: stats.misses,
      hitRate:
        stats.hits + stats.misses > 0
          ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) + '%'
          : '0%',
      maxSize: config.CACHE_MAX_SIZE,
    };
  }
}

export const cacheService = new CacheService();
