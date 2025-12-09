import mongoose, { Schema, Document, Types } from 'mongoose';

export interface IGoogleExportAudit extends Document {
    _id: Types.ObjectId;
    userId: Types.ObjectId;
    connectionId: Types.ObjectId;
    exportType: 'sheets' | 'docs' | 'drive';
    datasetType: 'cost_data' | 'analytics' | 'report' | 'budget' | 'usage' | 'custom';
    fileId: string; // Google Drive file ID
    fileName: string;
    fileLink: string; // Web view link
    scope: string; // What data was exported (e.g., "last_30_days", "project_x")
    recordCount?: number; // Number of records exported
    metadata?: {
        startDate?: Date;
        endDate?: Date;
        projectId?: string;
        filters?: Record<string, any>;
        redactionApplied?: boolean;
        maskingOptions?: string[];
    };
    exportedAt: Date;
    createdAt: Date;
}

const googleExportAuditSchema = new Schema<IGoogleExportAudit>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    connectionId: {
        type: Schema.Types.ObjectId,
        ref: 'GoogleConnection',
        required: true,
        index: true
    },
    exportType: {
        type: String,
        enum: ['sheets', 'docs', 'drive'],
        required: true,
        index: true
    },
    datasetType: {
        type: String,
        enum: ['cost_data', 'analytics', 'report', 'budget', 'usage', 'custom'],
        required: true,
        index: true
    },
    fileId: {
        type: String,
        required: true,
        index: true
    },
    fileName: {
        type: String,
        required: true
    },
    fileLink: {
        type: String,
        required: true
    },
    scope: {
        type: String,
        required: true
    },
    recordCount: {
        type: Number,
        min: 0
    },
    metadata: {
        startDate: Date,
        endDate: Date,
        projectId: String,
        filters: Schema.Types.Mixed,
        redactionApplied: Boolean,
        maskingOptions: [String]
    },
    exportedAt: {
        type: Date,
        required: true,
        default: Date.now,
        index: true
    }
}, {
    timestamps: true,
    collection: 'google_export_audits'
});

// Compound indexes for common queries
googleExportAuditSchema.index({ userId: 1, exportedAt: -1 });
googleExportAuditSchema.index({ userId: 1, exportType: 1, exportedAt: -1 });
googleExportAuditSchema.index({ connectionId: 1, exportedAt: -1 });

export const GoogleExportAudit = mongoose.model<IGoogleExportAudit>('GoogleExportAudit', googleExportAuditSchema);

