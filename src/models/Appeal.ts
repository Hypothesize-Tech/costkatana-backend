import mongoose, { Schema, Document, Types } from 'mongoose';

/**
 * Appeal Model - Moderation Decision Appeals
 *
 * Tracks user appeals against moderation decisions with workflow support
 */

export type AppealStatus = 'pending' | 'under_review' | 'approved' | 'denied' | 'expired';

export interface IAppeal extends Document {
  _id: Types.ObjectId;

  // Appeal details
  threatId: Types.ObjectId;
  userId: Types.ObjectId;
  reason: string;
  additionalContext?: string;

  // Workflow
  status: AppealStatus;
  submittedAt: Date;
  reviewedAt?: Date;
  reviewedBy?: Types.ObjectId;
  reviewNotes?: string;

  // Resolution
  resolution?: 'approved' | 'denied' | 'escalated';
  resolutionNotes?: string;

  // Metadata
  createdAt: Date;
  updatedAt: Date;

  // Methods
  isExpired(): boolean;
  canBeReviewed(): boolean;
}

const AppealSchema = new Schema<IAppeal>(
  {
    threatId: {
      type: Schema.Types.ObjectId,
      ref: 'ThreatLog',
      required: true,
      index: true
    },

    userId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true
    },

    reason: {
      type: String,
      required: true,
      maxlength: 1000
    },

    additionalContext: {
      type: String,
      maxlength: 2000
    },

    status: {
      type: String,
      enum: ['pending', 'under_review', 'approved', 'denied', 'expired'],
      default: 'pending',
      index: true
    },

    submittedAt: {
      type: Date,
      default: Date.now,
      index: true
    },

    reviewedAt: {
      type: Date
    },

    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User'
    },

    reviewNotes: {
      type: String,
      maxlength: 1000
    },

    resolution: {
      type: String,
      enum: ['approved', 'denied', 'escalated']
    },

    resolutionNotes: {
      type: String,
      maxlength: 1000
    }
  },
  {
    timestamps: true,
    collection: 'moderationappeals'
  }
);

// Compound indexes for efficient queries
AppealSchema.index({ userId: 1, status: 1 });
AppealSchema.index({ status: 1, submittedAt: 1 });
AppealSchema.index({ threatId: 1 });

// Instance methods
AppealSchema.methods.isExpired = function(): boolean {
  const EXPIRY_DAYS = 30; // Appeals expire after 30 days
  const expiryDate = new Date(this.submittedAt.getTime() + (EXPIRY_DAYS * 24 * 60 * 60 * 1000));
  return new Date() > expiryDate;
};

AppealSchema.methods.canBeReviewed = function(): boolean {
  return this.status === 'pending' && !this.isExpired();
};

// Static methods
AppealSchema.statics.findPendingAppeals = function(userId?: string) {
  const query: any = { status: 'pending' };
  if (userId) {
    query.userId = new Types.ObjectId(userId);
  }
  return this.find(query).sort({ submittedAt: -1 });
};

AppealSchema.statics.findExpiredAppeals = function() {
  const expiryDate = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
  return this.find({
    status: 'pending',
    submittedAt: { $lt: expiryDate }
  });
};

export const Appeal = mongoose.model<IAppeal>('Appeal', AppealSchema);