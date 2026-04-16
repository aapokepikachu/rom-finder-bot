import mongoose, { Document, Schema } from 'mongoose';

export interface ISetting extends Document {
  key: string;
  value: string;
  updatedBy: number;
}

const settingSchema = new Schema<ISetting>(
  {
    key: { type: String, required: true, unique: true, index: true },
    value: { type: String, required: true },
    updatedBy: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Setting = mongoose.model<ISetting>('Setting', settingSchema);

export const SETTING_KEYS = {
  REQUEST_URL: 'request_url',
  WELCOME_MESSAGE: 'welcome_message',
} as const;
