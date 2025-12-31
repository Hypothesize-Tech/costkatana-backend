import mongoose, { Document, Schema } from 'mongoose';

export interface IUploadedFile extends Document {
    userId: mongoose.Types.ObjectId;
    messageId?: mongoose.Types.ObjectId;
    conversationId?: mongoose.Types.ObjectId;
    fileName: string;
    originalName: string;
    fileSize: number;
    mimeType: string;
    s3Key: string;
    fileType: string;
    extractedText?: string;
    uploadedAt: Date;
    createdAt: Date;
    updatedAt: Date;
}

const UploadedFileSchema = new Schema<IUploadedFile>(
    {
        userId: {
            type: Schema.Types.ObjectId,
            ref: 'User',
            required: true,
            index: true
        },
        messageId: {
            type: Schema.Types.ObjectId,
            ref: 'ChatMessage'
        },
        conversationId: {
            type: Schema.Types.ObjectId,
            ref: 'Conversation'
        },
        fileName: {
            type: String,
            required: true
        },
        originalName: {
            type: String,
            required: true
        },
        fileSize: {
            type: Number,
            required: true
        },
        mimeType: {
            type: String,
            required: true
        },
        s3Key: {
            type: String,
            required: true,
            unique: true
        },
        fileType: {
            type: String,
            required: true
        },
        extractedText: {
            type: String
        },
        uploadedAt: {
            type: Date,
            default: Date.now
        }
    },
    {
        timestamps: true
    }
);

// Indexes for efficient queries
UploadedFileSchema.index({ userId: 1, uploadedAt: -1 });
UploadedFileSchema.index({ conversationId: 1 });
UploadedFileSchema.index({ messageId: 1 });

export const UploadedFile = mongoose.model<IUploadedFile>('UploadedFile', UploadedFileSchema);

