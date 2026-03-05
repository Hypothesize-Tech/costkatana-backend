import mongoose, { Schema, Document } from 'mongoose';

export interface IAuditAnchor extends Document {
  anchorId: string;
  anchorHash: string;
  startPosition: number;
  endPosition: number;
  entryCount: number;
  publishedAt?: Date;
  s3Location?: string;
  verified: boolean;
  verifiedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface IDailyAnchorSummary extends Document {
  date: string; // YYYY-MM-DD format
  totalAnchors: number;
  verifiedAnchors: number;
  publishedAnchors: number;
  totalEntries: number;
  lastAnchorId?: string;
  createdAt: Date;
  updatedAt: Date;
}

const AuditAnchorSchema = new Schema<IAuditAnchor>(
  {
    anchorId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    anchorHash: {
      type: String,
      required: true,
    },
    startPosition: {
      type: Number,
      required: true,
    },
    endPosition: {
      type: Number,
      required: true,
    },
    entryCount: {
      type: Number,
      required: true,
    },
    publishedAt: {
      type: Date,
    },
    s3Location: {
      type: String,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    verifiedAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
    collection: 'audit_anchors',
  }
);

// Keep anchor records for 1 year (regulatory requirement)
AuditAnchorSchema.index({ createdAt: 1 }, { expireAfterSeconds: 365 * 24 * 60 * 60 });

// Additional indexes for performance
AuditAnchorSchema.index({ verified: 1, createdAt: -1 });
AuditAnchorSchema.index({ publishedAt: 1 }, { sparse: true });

const DailyAnchorSummarySchema = new Schema<IDailyAnchorSummary>(
  {
    date: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    totalAnchors: {
      type: Number,
      default: 0,
    },
    verifiedAnchors: {
      type: Number,
      default: 0,
    },
    publishedAnchors: {
      type: Number,
      default: 0,
    },
    totalEntries: {
      type: Number,
      default: 0,
    },
    lastAnchorId: {
      type: String,
    },
  },
  {
    timestamps: true,
    collection: 'daily_anchor_summaries',
  }
);

// Index for date-based queries
DailyAnchorSummarySchema.index({ date: 1 });

export const AuditAnchor = mongoose.model<IAuditAnchor>('AuditAnchor', AuditAnchorSchema);
export const DailyAnchorSummary = mongoose.model<IDailyAnchorSummary>('DailyAnchorSummary', DailyAnchorSummarySchema);