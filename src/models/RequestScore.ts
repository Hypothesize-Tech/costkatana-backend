import mongoose, { Document, Schema } from 'mongoose';

export interface IRequestScore extends Document {
    requestId: string; // Links to usage record
    userId: mongoose.Types.ObjectId;
    score: number; // 1-5 rating for request quality
    notes?: string; // Optional notes about why this score was given
    scoredAt: Date;
    
    // Metadata for training suitability
    isTrainingCandidate: boolean; // Whether this request is suitable for training
    trainingTags: string[]; // Tags like 'concise', 'accurate', 'efficient'
    
    // Auto-calculated fields
    tokenEfficiency?: number; // Tokens per quality point
    costEfficiency?: number; // Cost per quality point
    
    createdAt: Date;
    updatedAt: Date;
}

const requestScoreSchema: Schema = new Schema({
    requestId: { 
        type: String, 
        required: true,
        index: true
    },
    userId: { 
        type: Schema.Types.ObjectId, 
        ref: 'User', 
        required: true,
        index: true
    },
    score: { 
        type: Number, 
        required: true, 
        min: 1, 
        max: 5 
    },
    notes: { 
        type: String, 
        maxlength: 500 
    },
    scoredAt: { 
        type: Date, 
        default: Date.now 
    },
    
    // Training metadata
    isTrainingCandidate: { 
        type: Boolean, 
        default: function(this: IRequestScore) {
            return this.score >= 4; // 4-5 star ratings are training candidates
        }
    },
    trainingTags: [{ 
        type: String,
        enum: ['concise', 'accurate', 'efficient', 'creative', 'helpful', 'clear', 'complete']
    }],
    
    // Efficiency metrics
    tokenEfficiency: Number,
    costEfficiency: Number
}, { 
    timestamps: true 
});

// Compound indexes for efficient queries
requestScoreSchema.index({ userId: 1, score: -1, scoredAt: -1 });
requestScoreSchema.index({ requestId: 1, userId: 1 }, { unique: true }); // One score per user per request
requestScoreSchema.index({ isTrainingCandidate: 1, score: -1 });
requestScoreSchema.index({ userId: 1, isTrainingCandidate: 1, score: -1 });

// Pre-save middleware to calculate efficiency metrics
requestScoreSchema.pre('save', function(next) {
    // These will be calculated when we link with usage data
    next();
});

export const RequestScore = mongoose.model<IRequestScore>('RequestScore', requestScoreSchema);