import mongoose, { Schema } from 'mongoose';

export interface IActivity {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    type: 'login' | 'api_call' | 'optimization_created' | 'optimization_applied' |
    'alert_created' | 'alert_resolved' | 'tip_viewed' | 'tip_applied' |
    'quality_scored' | 'settings_updated' | 'profile_updated' |
    'dashboard_api_key_created' | 'dashboard_api_key_deleted' | 'file_uploaded' | 'export_generated' |
    'bulk_optimization' | 'cost_audit_completed' | 'subscription_changed' |
    'template_created' | 'template_updated' | 'template_deleted' | 'template_forked' |
    'template_ai_generated' | 'template_optimized' | 'template_used' | 'template_used_with_context' | 'template_shared' |
    'template_feedback_added' | 'template_variables_detected' | 'template_effectiveness_predicted';                                                                      
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
        // Template-specific metadata
        templateId?: mongoose.Types.ObjectId;
        templateName?: string;
        templateCategory?: string;
        templateVersion?: number;
        intent?: string;
        confidence?: number;
        optimizationType?: 'token' | 'cost' | 'quality' | 'model-specific';
        tokenReduction?: number;
        costSaving?: number;
        effectivenessScore?: number;
        variablesCount?: number;
        targetModel?: string;
        originalTemplateId?: mongoose.Types.ObjectId;
        forkedTemplateId?: mongoose.Types.ObjectId;
        rating?: number;
        feedback?: string;
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
        required: true
    },
    type: {
        type: String,
        enum: [
            'login', 'api_call', 'optimization_created', 'optimization_applied',
            'alert_created', 'alert_resolved', 'tip_viewed', 'tip_applied',
            'quality_scored', 'settings_updated', 'profile_updated',
            'dashboard_api_key_created', 'dashboard_api_key_deleted', 'file_uploaded', 'export_generated',
            'bulk_optimization', 'cost_audit_completed', 'subscription_changed',
            'template_created', 'template_updated', 'template_deleted', 'template_forked',
            'template_ai_generated', 'template_optimized', 'template_used', 'template_shared',
            'template_feedback_added', 'template_variables_detected', 'template_effectiveness_predicted'
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