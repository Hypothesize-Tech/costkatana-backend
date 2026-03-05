import mongoose, { Schema, Document, Model } from 'mongoose';

export interface ICostTrackingRecord extends Document {
    repoFullName: string;
    userId: string;
    operationType: 'embedding' | 'query' | 'generation';
    count: number;
    tokensUsed?: number;
    cost: number;
    timestamp: Date;
}

const CostTrackingRecordSchema = new Schema<ICostTrackingRecord>({
    repoFullName: { type: String, required: true, index: true },
    userId: { type: String, required: true, index: true },
    operationType: { type: String, required: true, enum: ['embedding', 'query', 'generation'] },
    count: { type: Number, required: true, default: 1 },
    tokensUsed: { type: Number },
    cost: { type: Number, required: true },
    timestamp: { type: Date, required: true, default: Date.now }
}, {
    timestamps: true,
    collection: 'cost_tracking_records'
});

CostTrackingRecordSchema.index({ repoFullName: 1, userId: 1, timestamp: -1 });

export const CostTrackingRecord: Model<ICostTrackingRecord> = mongoose.models.CostTrackingRecord
    ?? mongoose.model<ICostTrackingRecord>('CostTrackingRecord', CostTrackingRecordSchema);
export default CostTrackingRecord;
