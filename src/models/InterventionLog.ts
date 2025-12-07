import mongoose, { Schema, Document } from 'mongoose';

// ============================================================================
// INTERVENTION LOG MODEL
// ============================================================================

export interface IInterventionLog extends Document {
    timestamp: Date;
    userId: mongoose.Types.ObjectId;
    flowId: string;
    interventionType: 'model_downgrade' | 'provider_switch' | 'prompt_compression' | 'budget_block' | 'rate_limit_switch';
    originalRequest: {
        model: string;
        provider: string;
        estimatedCost: number;
        promptLength?: number;
        prompt?: string;
    };
    modifiedRequest: {
        model: string;
        provider: string;
        actualCost: number;
        promptLength?: number;
        prompt?: string;
    };
    reason: string;
    costSaved: number;
    qualityImpact?: number; // -1 to 1, where 0 is neutral
    metadata?: {
        userTier?: string;
        priority?: string;
        budgetRemaining?: number;
        [key: string]: any;
    };
}

const InterventionLogSchema = new Schema<IInterventionLog>({
    timestamp: { 
        type: Date, 
        required: true, 
        default: Date.now,
        index: true 
    },
    userId: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true 
    },
    flowId: { 
        type: String, 
        required: true,
        index: true 
    },
    interventionType: { 
        type: String, 
        enum: ['model_downgrade', 'provider_switch', 'prompt_compression', 'budget_block', 'rate_limit_switch'],
        required: true,
        index: true
    },
    originalRequest: {
        model: { type: String, required: true },
        provider: { type: String, required: true },
        estimatedCost: { type: Number, required: true },
        promptLength: { type: Number },
        prompt: { type: String }
    },
    modifiedRequest: {
        model: { type: String, required: true },
        provider: { type: String, required: true },
        actualCost: { type: Number, required: true },
        promptLength: { type: Number },
        prompt: { type: String }
    },
    reason: { type: String, required: true },
    costSaved: { type: Number, required: true, default: 0 },
    qualityImpact: { type: Number, min: -1, max: 1 },
    metadata: { type: Schema.Types.Mixed }
}, {
    timestamps: true,
    collection: 'intervention_logs'
});

// Compound indexes for efficient queries
InterventionLogSchema.index({ userId: 1, timestamp: -1 });
InterventionLogSchema.index({ interventionType: 1, timestamp: -1 });
InterventionLogSchema.index({ flowId: 1, timestamp: -1 });

// TTL index - automatically remove old logs after 90 days
InterventionLogSchema.index({ timestamp: 1 }, { expireAfterSeconds: 7776000 }); // 90 days

export const InterventionLog = mongoose.model<IInterventionLog>('InterventionLog', InterventionLogSchema);

