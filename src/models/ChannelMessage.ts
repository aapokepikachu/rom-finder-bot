import mongoose, { Document, Schema } from 'mongoose';

export interface IChannelMessage extends Document {
  channelId: string;
  messageId: number;
  fileName: string;
  caption: string;
  category?: string;
  fileSize?: number;
  fileType?: string;
  fileId?: string;
  cleanName?: string;  // normalised for search — stripped of @handles, extensions, underscores
  receivedAt: Date;
}

const channelMessageSchema = new Schema<IChannelMessage>(
  {
    channelId: { type: String, required: true, index: true },
    messageId: { type: Number, required: true },
    fileName: { type: String, required: true, index: 'text' },
    caption: { type: String, default: '', index: 'text' },
    category: { type: String, index: true },
    fileSize: Number,
    fileType: String,
    fileId: String,
    cleanName: { type: String, index: true },
    receivedAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

// Compound unique index to avoid duplicate messages
channelMessageSchema.index({ channelId: 1, messageId: 1 }, { unique: true });

// Text index for fallback text search
channelMessageSchema.index({ fileName: 'text', caption: 'text' });

export const ChannelMessage = mongoose.model<IChannelMessage>(
  'ChannelMessage',
  channelMessageSchema
);
