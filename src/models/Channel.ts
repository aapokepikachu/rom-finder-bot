import mongoose, { Document, Schema } from 'mongoose';
import { CATEGORIES, Category } from '../config';

export interface IChannel extends Document {
  channelId: string;
  category: Category;
  title?: string;
  username?: string;
  mappedBy: number;
  mappedAt: Date;
}

const channelSchema = new Schema<IChannel>(
  {
    channelId: { type: String, required: true, unique: true, index: true },
    category: {
      type: String,
      required: true,
      enum: CATEGORIES,
      index: true,
    },
    title: String,
    username: String,
    mappedBy: { type: Number, required: true },
    mappedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Channel = mongoose.model<IChannel>('Channel', channelSchema);
