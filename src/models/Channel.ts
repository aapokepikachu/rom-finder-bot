import mongoose, { Document, Schema } from 'mongoose';

export interface IChannel extends Document {
  channelId: string;
  category: string;      // free text — admin defines it (e.g. "Pokemon NDS", "GBA Hacks")
  label: string;         // button label shown in /search keyboard (e.g. "🎮 NDS")
  title?: string;
  username?: string;
  mappedBy: number;
  mappedAt: Date;
}

const channelSchema = new Schema<IChannel>(
  {
    channelId: { type: String, required: true, unique: true, index: true },
    category:  { type: String, required: true, index: true },
    label:     { type: String, required: true },   // short button label
    title:     String,
    username:  String,
    mappedBy:  { type: Number, required: true },
    mappedAt:  { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Channel = mongoose.model<IChannel>('Channel', channelSchema);
