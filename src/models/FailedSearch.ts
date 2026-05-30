import mongoose, { Document, Schema } from 'mongoose';

/**
 * Tracks queries that returned zero results.
 * Used by /failed_searches to show admins what users can't find,
 * so they can backfill the right files.
 */
export interface IFailedSearch extends Document {
  query:           string;   // original casing
  normalizedQuery: string;   // lowercased
  category:        string;   // 'ALL' | channelId | 'tag::xxx'
  categoryLabel:   string;   // human-readable label for display
  count:           number;   // how many times this exact query+category failed
  lastFailedAt:    Date;
}

const failedSearchSchema = new Schema<IFailedSearch>(
  {
    query:           { type: String, required: true },
    normalizedQuery: { type: String, required: true },
    category:        { type: String, required: true, default: 'ALL' },
    categoryLabel:   { type: String, required: true, default: 'All' },
    count:           { type: Number, default: 1 },
    lastFailedAt:    { type: Date,   default: Date.now },
  },
  { timestamps: true }
);

// Unique per query+category pair so we can upsert+increment
failedSearchSchema.index(
  { normalizedQuery: 1, category: 1 },
  { unique: true }
);

// For sorting by most-failed
failedSearchSchema.index({ count: -1 });

export const FailedSearch = mongoose.model<IFailedSearch>('FailedSearch', failedSearchSchema);
