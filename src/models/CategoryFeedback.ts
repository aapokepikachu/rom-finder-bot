import mongoose, { Document, Schema } from 'mongoose';

/**
 * Tracks whether the category a user chose led to a successful find.
 * A ❌ vote on a result records that the category may have been wrong.
 * Aggregated to suggest "try a different category?" when the category
 * has a high miss rate for a given query.
 */
export interface ICategoryFeedback extends Document {
  normalizedQuery: string;
  category:        string;   // channelId, 'tag::xxx', or 'ALL'
  categoryLabel:   string;
  userId:          number;
  helpful:         boolean;  // true = ✅ vote, false = ❌ vote
  createdAt:       Date;
}

const categoryFeedbackSchema = new Schema<ICategoryFeedback>(
  {
    normalizedQuery: { type: String, required: true, index: true },
    category:        { type: String, required: true },
    categoryLabel:   { type: String, required: true, default: 'All' },
    userId:          { type: Number, required: true },
    helpful:         { type: Boolean, required: true },
  },
  { timestamps: true }
);

// One vote per user per query+category
categoryFeedbackSchema.index(
  { normalizedQuery: 1, category: 1, userId: 1 },
  { unique: true }
);

// For aggregating miss-rates per category
categoryFeedbackSchema.index({ normalizedQuery: 1, category: 1 });

export const CategoryFeedback = mongoose.model<ICategoryFeedback>(
  'CategoryFeedback',
  categoryFeedbackSchema
);
