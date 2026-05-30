import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../utils/logger';

let isConnected = false;

export async function connectDB(): Promise<void> {
  if (isConnected) return;

  try {
    await mongoose.connect(config.MONGODB_URI, {
      serverSelectionTimeoutMS: 10000,
      socketTimeoutMS: 45000,
      maxPoolSize: 10,
      minPoolSize: 2,
    });

    isConnected = true;
    logger.info('✅ MongoDB connected successfully');

    mongoose.connection.on('error', (err) => {
      logger.error('MongoDB connection error:', err);
      isConnected = false;
    });
    mongoose.connection.on('disconnected', () => {
      logger.warn('MongoDB disconnected. Reconnecting...');
      isConnected = false;
    });
    mongoose.connection.on('reconnected', () => {
      logger.info('MongoDB reconnected');
      isConnected = true;
    });
  } catch (error) {
    logger.error('Failed to connect to MongoDB:', error);
    throw error;
  }
}

/**
 * Returns per-collection document counts.
 * Uses countDocuments() — works on Atlas M0 free tier.
 * Atlas M0 does NOT support db.stats() (admin command) — never use it.
 */
export async function getCollectionCounts(): Promise<Record<string, number>> {
  const models = mongoose.modelNames();
  const counts: Record<string, number> = {};
  await Promise.all(
    models.map(async (name) => {
      counts[name] = await mongoose.model(name).countDocuments();
    })
  );
  return counts;
}

/**
 * Estimated storage used based on document counts and avg doc sizes.
 * Atlas M0 limit is 512 MB. Returns percentage used.
 */
export function estimateStorageUsage(counts: Record<string, number>): {
  estimatedMB: number;
  percentUsed: string;
  warningLevel: 'ok' | 'warn' | 'critical';
} {
  // Rough avg bytes per document per collection
  const AVG_SIZES: Record<string, number> = {
    ChannelMessage:   600,
    User:             250,
    Search:           120,
    Channel:          150,
    Featured:         200,
    Setting:          100,
    SearchFeedback:   180,
    FailedSearch:     150,
    CategoryFeedback: 160,
  };

  let totalBytes = 0;
  for (const [name, count] of Object.entries(counts)) {
    totalBytes += count * (AVG_SIZES[name] ?? 300);
  }

  const estimatedMB   = totalBytes / (1024 * 1024);
  const limitMB       = 512;
  const percent       = (estimatedMB / limitMB) * 100;
  const warningLevel  = percent > 80 ? 'critical' : percent > 60 ? 'warn' : 'ok';

  return {
    estimatedMB,
    percentUsed:  percent.toFixed(1) + '%',
    warningLevel,
  };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024)          return `${bytes} B`;
  if (bytes < 1024 * 1024)   return `${(bytes / 1024).toFixed(2)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}
