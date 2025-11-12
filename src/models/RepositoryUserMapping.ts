import { Schema, model, Document } from 'mongoose';

export interface IRepositoryUserMapping extends Document {
    repositoryFullName: string; // owner/repo format
    userId: string;
    connectionId: string;
    createdAt: Date;
    updatedAt: Date;
}

const repositoryUserMappingSchema = new Schema<IRepositoryUserMapping>({
    repositoryFullName: {
        type: String,
        required: true,
        index: true,
        unique: true
    },
    userId: {
        type: String,
        required: true,
        index: true
    },
    connectionId: {
        type: String,
        required: true
    }
}, {
    timestamps: true,
    collection: 'repository_user_mappings'
});

// Compound index for efficient lookups
repositoryUserMappingSchema.index({ repositoryFullName: 1, userId: 1 });

export const RepositoryUserMapping = model<IRepositoryUserMapping>('RepositoryUserMapping', repositoryUserMappingSchema);

