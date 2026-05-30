import mongoose, { Document, Schema } from 'mongoose';

export interface ISetting extends Document {
  key: string;
  value: string;
  updatedBy: number;
}

const settingSchema = new Schema<ISetting>(
  {
    key:       { type: String, required: true, unique: true, index: true },
    value:     { type: String, required: true },
    updatedBy: { type: Number, required: true },
  },
  { timestamps: true }
);

export const Setting = mongoose.model<ISetting>('Setting', settingSchema);

export const SETTING_KEYS = {
  REQUEST_URL:          'request_url',
  WELCOME_MESSAGE:      'welcome_message',
  MAINTENANCE:          'maintenance',           // value: 'on' | 'off'
  BLOCKED_TAGS:         'blocked_tags',          // comma-separated e.g. "#misc,#test"
  RANDOM_EXCLUDED_TAGS: 'random_excluded_tags',  // tags hidden from /random
  RANDOM_EXCLUDED_IDS:  'random_excluded_ids',   // "channelId:messageId" pairs hidden from /random
  VAGUE_SEARCH_HINT:    'vague_search_hint',     // custom hint shown on vague single-word queries
} as const;
