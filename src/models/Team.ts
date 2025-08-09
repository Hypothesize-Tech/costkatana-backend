import { Schema, model, Document, ObjectId } from 'mongoose';

export interface ITeam extends Document {
    _id: ObjectId;
    name: string;
    description?: string;
    organizationId?: ObjectId; // For multi-tenant setups
    ownerId: ObjectId; // Team owner/admin
    members: ObjectId[]; // Team member user IDs
    projectIds: ObjectId[]; // Projects this team has access to
    settings: {
        defaultBudgetLimit?: number;
        defaultPermissions: ('read' | 'write' | 'admin')[];
        allowMembersToCreateKeys: boolean;
        requireApprovalForKeys: boolean;
    };
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const teamSchema = new Schema<ITeam>({
    name: {
        type: String,
        required: true,
        trim: true,
        maxlength: 100
    },
    description: {
        type: String,
        trim: true,
        maxlength: 500
    },
    organizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Organization'
    },
    ownerId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    members: [{
        type: Schema.Types.ObjectId,
        ref: 'User'
    }],
    projectIds: [{
        type: Schema.Types.ObjectId,
        ref: 'Project'
    }],
    settings: {
        defaultBudgetLimit: {
            type: Number,
            min: 0
        },
        defaultPermissions: [{
            type: String,
            enum: ['read', 'write', 'admin'],
            default: 'read'
        }],
        allowMembersToCreateKeys: {
            type: Boolean,
            default: false
        },
        requireApprovalForKeys: {
            type: Boolean,
            default: true
        }
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes
teamSchema.index({ ownerId: 1, isActive: 1 });
teamSchema.index({ members: 1, isActive: 1 });
teamSchema.index({ organizationId: 1, isActive: 1 });
teamSchema.index({ name: 1, organizationId: 1 }, { unique: true });

export const Team = model<ITeam>('Team', teamSchema);