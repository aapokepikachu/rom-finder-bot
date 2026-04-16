import mongoose, { Document, Schema } from 'mongoose';

export interface ISearch extends Document {
  query: string;
  normalizedQuery: string;
  count: number;
  lastSearchedAt: Date;
}

const searchSchema = new Schema<ISearch>(
  {
    query: { type: String, required: true },
    normalizedQuery: { type: String, required: true, unique: true, index: true },
    count: { type: Number, default: 1, index: -1 },
    lastSearchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Index for /top command (top 5 by count)
searchSchema.index({ count: -1 });

export const Search = mongoose.model<ISearch>('Search', searchSchema);
