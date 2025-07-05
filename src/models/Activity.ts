import mongoose, { Schema } from 'mongoose';

export interface IActivity {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    type: 'login' | 'api_call' | 'optimization_created' | 'optimization_applied' |
    'alert_created' | 'alert_resolved' | 'tip_viewed' | 'tip_applied' |
    'quality_scored' | 'settings_updated' | 'profile_updated' |
    'dashboard_api_key_created' | 'dashboard_api_key_deleted' | 'file_uploaded' | 'export_generated' |
    'bulk_optimization' | 'cost_audit_completed' | 'subscription_changed';
    title: string;
    description?: string;
    metadata?: {
        service?: string;
        model?: string;
        cost?: number;
        saved?: number;
        optimizationId?: mongoose.Types.ObjectId;
        alertId?: mongoose.Types.ObjectId;
        tipId?: mongoose.Types.ObjectId;
        qualityScoreId?: mongoose.Types.ObjectId;
        [key: string]: any;
    };
    ipAddress?: string;
    userAgent?: string;
    createdAt: Date;
    updatedAt: Date;
}

const activitySchema = new Schema<IActivity>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        index: true
    },
    type: {
        type: String,
        enum: [
            'login', 'api_call', 'optimization_created', 'optimization_applied',
            'alert_created', 'alert_resolved', 'tip_viewed', 'tip_applied',
            'quality_scored', 'settings_updated', 'profile_updated',
            'dashboard_api_key_created', 'dashboard_api_key_deleted', 'file_uploaded', 'export_generated',
            'bulk_optimization', 'cost_audit_completed', 'subscription_changed'
        ],
        required: true
    },
    title: {
        type: String,
        required: true
    },
    description: String,
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    },
    ipAddress: String,
    userAgent: String
}, {
    timestamps: true
});

// Indexes for efficient querying
activitySchema.index({ userId: 1, createdAt: -1 });
activitySchema.index({ userId: 1, type: 1, createdAt: -1 });

export const Activity = mongoose.model<IActivity>('Activity', activitySchema); 