import { Schema, model, Document, ObjectId } from 'mongoose';

export interface IWorkspace extends Document {
  _id: ObjectId;
  name: string;
  slug: string;
  ownerId: ObjectId;
  settings: {
    allowMemberInvites: boolean;
    defaultProjectAccess: 'all' | 'assigned';
    requireEmailVerification: boolean;
  };
  billing: {
    seatsIncluded: number;
    additionalSeats: number;
    pricePerSeat: number;
    billingCycle: 'monthly' | 'yearly';
  };
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const workspaceSchema = new Schema<IWorkspace>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    slug: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: /^[a-z0-9-]+$/,
    },
    ownerId: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    settings: {
      allowMemberInvites: {
        type: Boolean,
        default: false,
      },
      defaultProjectAccess: {
        type: String,
        enum: ['all', 'assigned'],
        default: 'assigned',
      },
      requireEmailVerification: {
        type: Boolean,
        default: true,
      },
    },
    billing: {
      seatsIncluded: {
        type: Number,
        default: 1,
        min: 1,
      },
      additionalSeats: {
        type: Number,
        default: 0,
        min: 0,
      },
      pricePerSeat: {
        type: Number,
        default: 10,
        min: 0,
      },
      billingCycle: {
        type: String,
        enum: ['monthly', 'yearly'],
        default: 'monthly',
      },
    },
    isActive: {
      type: Boolean,
      default: true,
    },
  },
  {
    timestamps: true,
  }
);

// Indexes
workspaceSchema.index({ ownerId: 1 });
workspaceSchema.index({ slug: 1 });
workspaceSchema.index({ isActive: 1 });

export const Workspace = model<IWorkspace>('Workspace', workspaceSchema);

