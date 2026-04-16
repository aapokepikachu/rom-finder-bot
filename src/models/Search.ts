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
    // unique:true already creates an index — no need for index:true as well
    normalizedQuery: { type: String, required: true, unique: true },
    // index defined once via schema.index() below — removed inline index:-1
    count: { type: Number, default: 1 },
    lastSearchedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

// Single index declaration for /top queries
searchSchema.index({ count: -1 });

export const Search = mongoose.model<ISearch>('Search', searchSchema);
