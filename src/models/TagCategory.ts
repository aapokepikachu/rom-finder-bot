import mongoose, { Document, Schema } from 'mongoose';

/**
 * Tag-based search category.
 *
 * Instead of mapping to a specific channel, this category filters
 * ALL indexed messages by whether their caption contains the given tag.
 *
 * Example:
 *   tag:   "#emulator"
 *   label: "🕹️ Emulators"
 *
 * When a user picks "Emulators" in /search, only files whose caption
 * contains "#emulator" are returned — regardless of which channel they
 * came from.
 */
export interface ITagCategory extends Document {
  tag:      string;   // lowercase hashtag e.g. "#emulator"
  label:    string;   // button label shown in /search
  addedBy:  number;
  addedAt:  Date;
}

const tagCategorySchema = new Schema<ITagCategory>(
  {
    tag:     { type: String, required: true, unique: true, index: true },
    label:   { type: String, required: true },
    addedBy: { type: Number, required: true },
    addedAt: { type: Date,   default: Date.now },
  },
  { timestamps: true }
);

export const TagCategory = mongoose.model<ITagCategory>('TagCategory', tagCategorySchema);
