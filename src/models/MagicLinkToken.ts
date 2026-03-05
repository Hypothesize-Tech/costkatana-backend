import mongoose, { Schema, Document } from 'mongoose';

export interface IMagicLinkToken extends Document {
  token: string;
  email: string;
  name?: string;
  source?: string;
  sessionId?: string;
  createdAt: Date;
  expiresAt: Date;
  usedAt?: Date;
  isUsed: boolean;
  markAsUsed(): Promise<IMagicLinkToken>;
}

const MagicLinkTokenSchema = new Schema<IMagicLinkToken>({
  token: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    trim: true
  },
  source: {
    type: String,
    default: 'web',
    enum: ['web', 'chatgpt', 'cursor', 'api']
  },
  sessionId: {
    type: String
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 900 // TTL index - auto-delete after 15 minutes (900 seconds)
  },
  expiresAt: {
    type: Date,
    required: true,
    index: true
  },
  usedAt: {
    type: Date
  },
  isUsed: {
    type: Boolean,
    default: false,
    index: true
  }
}, {
  timestamps: true,
  collection: 'magic_link_tokens'
});

// Compound index for efficient queries
MagicLinkTokenSchema.index({ token: 1, isUsed: 1 });
MagicLinkTokenSchema.index({ email: 1, isUsed: 1 });
MagicLinkTokenSchema.index({ expiresAt: 1, isUsed: 1 });

// Instance methods
MagicLinkTokenSchema.methods.isExpired = function(): boolean {
  return new Date() > this.expiresAt;
};

MagicLinkTokenSchema.methods.markAsUsed = function(): Promise<IMagicLinkToken> {
  this.isUsed = true;
  this.usedAt = new Date();
  return this.save();
};

// Static methods
MagicLinkTokenSchema.statics.findValidToken = function(token: string): Promise<IMagicLinkToken | null> {
  return this.findOne({
    token,
    isUsed: false,
    expiresAt: { $gt: new Date() }
  });
};

MagicLinkTokenSchema.statics.cleanupExpiredTokens = function(): Promise<any> {
  return this.deleteMany({
    $or: [
      { expiresAt: { $lt: new Date() } },
      { isUsed: true, usedAt: { $lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } } // Delete used tokens after 24 hours
    ]
  });
};

export const MagicLinkToken = mongoose.model<IMagicLinkToken>('MagicLinkToken', MagicLinkTokenSchema);

export default MagicLinkToken;