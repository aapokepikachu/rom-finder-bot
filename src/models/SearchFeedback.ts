import mongoose, { Document, Schema } from 'mongoose';

/**
 * Stores "Did you get the ROM?" feedback per search result.
 * Used to boost scores on future searches — confirmed matches
 * rise to the top, misses get penalised slightly.
 */
export interface ISearchFeedback extends Document {
  normalizedQuery: string;
  channelId: string;
  messageId: number;
  fileName: string;
  gotIt: boolean;          // true = confirmed match, false = not what they wanted
  userId: number;
  createdAt: Date;
}

const feedbackSchema = new Schema<ISearchFeedback>(
  {
    normalizedQuery: { type: String, required: true, index: true },
    channelId:       { type: String, required: true },
    messageId:       { type: Number, required: true },
    fileName:        { type: String, required: true },
    gotIt:           { type: Boolean, required: true },
    userId:          { type: Number, required: true },
  },
  { timestamps: true }
);

// One feedback per user per result per query
feedbackSchema.index(
  { normalizedQuery: 1, channelId: 1, messageId: 1, userId: 1 },
  { unique: true }
);

// For aggregating boost scores per result
feedbackSchema.index({ normalizedQuery: 1, channelId: 1, messageId: 1 });

// For decay: querying by recency
feedbackSchema.index({ createdAt: -1 });

export const SearchFeedback = mongoose.model<ISearchFeedback>('SearchFeedback', feedbackSchema);
