import mongoose, { Schema, Document } from 'mongoose';

export interface IGoogleFileAccess extends Document {
    userId: mongoose.Types.ObjectId;
    connectionId: mongoose.Types.ObjectId;
    fileId: string;
    fileName: string;
    fileType: 'docs' | 'sheets' | 'drive';
    mimeType: string;
    accessMethod: 'app_created' | 'picker_selected';
    lastAccessedAt: Date;
    webViewLink?: string;
    metadata?: {
        size?: number;
        createdTime?: string;
        modifiedTime?: string;
        iconLink?: string;
    };
    createdAt: Date;
    updatedAt: Date;
}

const GoogleFileAccessSchema = new Schema<IGoogleFileAccess>(
    {
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
        fileId: {
            type: String,
            required: true,
            index: true
        },
        fileName: {
            type: String,
            required: true
        },
        fileType: {
            type: String,
            enum: ['docs', 'sheets', 'drive'],
            required: true,
            index: true
        },
        mimeType: {
            type: String,
            required: true
        },
        accessMethod: {
            type: String,
            enum: ['app_created', 'picker_selected'],
            required: true,
            default: 'picker_selected'
        },
        lastAccessedAt: {
            type: Date,
            default: Date.now,
            index: true
        },
        webViewLink: {
            type: String
        },
        metadata: {
            size: Number,
            createdTime: String,
            modifiedTime: String,
            iconLink: String
        }
    },
    {
        timestamps: true
    }
);

// Compound index for efficient queries
GoogleFileAccessSchema.index({ userId: 1, connectionId: 1, fileType: 1 });
GoogleFileAccessSchema.index({ userId: 1, fileId: 1 }, { unique: true });

// Update lastAccessedAt on each access
GoogleFileAccessSchema.methods.updateAccess = function() {
    this.lastAccessedAt = new Date();
    return this.save();
};

export const GoogleFileAccess = mongoose.model<IGoogleFileAccess>('GoogleFileAccess', GoogleFileAccessSchema);

