import mongoose, { Schema, Document } from 'mongoose';

export interface IScheduledReport extends Document {
    name: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    format: 'csv' | 'excel' | 'json';
    recipients: string[];
    config: {
        format: 'csv' | 'excel' | 'json';
        startDate?: Date;
        endDate?: Date;
        includeCharts?: boolean;
        sections?: string[];
    };
    lastSent?: Date;
    nextSend?: Date;
    isActive: boolean;
    createdBy?: mongoose.Types.ObjectId;
    createdAt: Date;
    updatedAt: Date;
}

const scheduledReportSchema = new Schema<IScheduledReport>({
    name: {
        type: String,
        required: true,
        trim: true
    },
    frequency: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        required: true
    },
    format: {
        type: String,
        enum: ['csv', 'excel', 'json'],
        required: true
    },
    recipients: {
        type: [String],
        required: true,
        validate: {
            validator: (v: string[]) => v.length > 0,
            message: 'At least one recipient is required'
        }
    },
    config: {
        format: {
            type: String,
            enum: ['csv', 'excel', 'json'],
            required: true
        },
        startDate: Date,
        endDate: Date,
        includeCharts: Boolean,
        sections: [String]
    },
    lastSent: Date,
    nextSend: Date,
    isActive: {
        type: Boolean,
        default: true,
        index: true
    },
    createdBy: {
        type: Schema.Types.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Indexes
scheduledReportSchema.index({ isActive: 1, nextSend: 1 });
scheduledReportSchema.index({ createdBy: 1 });
scheduledReportSchema.index({ frequency: 1 });

export const ScheduledReport = mongoose.model<IScheduledReport>('ScheduledReport', scheduledReportSchema);

