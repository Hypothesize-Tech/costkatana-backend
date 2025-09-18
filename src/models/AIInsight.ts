import mongoose, { Schema, Document } from 'mongoose';

export interface IAIInsight extends Document {
    type: string;
    userId?: mongoose.Types.ObjectId;
    metadata?: any;
    timestamp?: Date;
    createdAt?: Date;
    updatedAt?: Date;
}

const AIInsightSchema = new Schema<IAIInsight>({
    type: {
        type: String,
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    },
    metadata: {
        type: Schema.Types.Mixed
    },
    timestamp: {
        type: Date,
        default: Date.now
    }
}, {
    timestamps: true
});

// Indexes
AIInsightSchema.index({ type: 1, userId: 1 });
AIInsightSchema.index({ timestamp: -1 });
AIInsightSchema.index({ 'metadata.templateId': 1 });

export const AIInsight = mongoose.model<IAIInsight>('AIInsight', AIInsightSchema);

