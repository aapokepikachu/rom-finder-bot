import mongoose, { Document, Schema } from 'mongoose';

export interface IFeatured extends Document {
  position: number;
  title: string;
  channelId: string;
  messageId: number;
  category?: string;
  addedBy: number;
}

const featuredSchema = new Schema<IFeatured>(
  {
    // unique:true already implies an index — removed the redundant schema.index() below
    position: { type: Number, required: true, unique: true, min: 1, max: 10 },
    title: { type: String, required: true },
    channelId: { type: String, required: true },
    messageId: { type: Number, required: true },
    category: String,
    addedBy: { type: Number, required: true },
  },
  { timestamps: true }
);

// No extra schema.index needed — unique:true on `position` handles it

export const Featured = mongoose.model<IFeatured>('Featured', featuredSchema);
