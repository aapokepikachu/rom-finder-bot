import mongoose, { Document, Schema } from 'mongoose';

export interface IUser extends Document {
  userId: number;
  username?: string;
  firstName: string;
  lastName?: string;
  isBlocked: boolean;
  isDeleted: boolean;
  joinedAt: Date;
  lastActiveAt: Date;
  totalSearches: number;
}

const userSchema = new Schema<IUser>(
  {
    userId: { type: Number, required: true, unique: true, index: true },
    username: { type: String, index: true },
    firstName: { type: String, required: true },
    lastName: String,
    isBlocked: { type: Boolean, default: false, index: true },
    isDeleted: { type: Boolean, default: false, index: true },
    joinedAt: { type: Date, default: Date.now },
    lastActiveAt: { type: Date, default: Date.now, index: true },
    totalSearches: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound index for active users query
userSchema.index({ isBlocked: 1, isDeleted: 1 });

export const User = mongoose.model<IUser>('User', userSchema);
