import { Schema, model, Document, ObjectId } from 'mongoose';

export interface IProviderKey extends Document {
    _id: ObjectId;
    name: string;
    provider: 'openai' | 'anthropic' | 'google' | 'cohere' | 'aws-bedrock' | 'deepseek' | 'groq';
    encryptedKey: string;
    maskedKey: string;
    userId: ObjectId;
    description?: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    lastUsed?: Date;
}

const providerKeySchema = new Schema<IProviderKey>({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    provider: {
        type: String,
        required: true,
        enum: ['openai', 'anthropic', 'google', 'cohere', 'aws-bedrock', 'deepseek', 'groq']
    },
    encryptedKey: {
        type: String,
        required: true
    },
    maskedKey: {
        type: String,
        required: true
    },
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500
    },
    isActive: {
        type: Boolean,
        default: true
    },
    lastUsed: {
        type: Date
    }
}, {
    timestamps: true
});

// Indexes for performance
providerKeySchema.index({ userId: 1, provider: 1 });
providerKeySchema.index({ userId: 1, isActive: 1 });


// Compound unique index to prevent duplicate provider keys per user
providerKeySchema.index({ userId: 1, provider: 1, name: 1 }, { unique: true });

export const ProviderKey = model<IProviderKey>('ProviderKey', providerKeySchema);