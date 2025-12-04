import mongoose, { Schema, ObjectId } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser {
    email: string;
    password: string;
    name: string;
    avatar?: string;
    role: 'user' | 'admin';
    workspaceId?: ObjectId;
    workspaceMemberships: Array<{
        workspaceId: ObjectId;
        role: 'owner' | 'admin' | 'developer' | 'viewer';
        joinedAt: Date;
    }>;
    otherEmails: Array<{
        email: string;
        verified: boolean;
        verificationToken?: string;
        addedAt: Date;
    }>;
    dashboardApiKeys: Array<{
        name: string;
        keyId: string;
        encryptedKey: string;
        maskedKey: string;
        permissions: string[];
        lastUsed?: Date;
        createdAt: Date;
        expiresAt?: Date;
        isActive?: boolean;
    }>;
    apiKeys: Array<{
        id: string;
        name: string;
        key: string;
        created: Date;
        lastUsed?: Date;
        isActive: boolean;
    }>;
    preferences: {
        emailAlerts: boolean;
        alertThreshold: number;
        optimizationSuggestions: boolean;
        enableSessionReplay?: boolean;
        sessionReplayTimeout?: number;
        lastDigestSent?: Date;
        maxConcurrentUserSessions?: number;
        userSessionNotificationEnabled?: boolean;
        emailEngagement?: {
            totalSent: number;
            totalOpened: number;
            totalClicked: number;
            lastOpened?: Date;
            consecutiveIgnored: number;
        };
        integrations?: {
            defaultChannels?: string[]; // Default integration IDs for all alerts
            alertTypeRouting?: Map<string, string[]>; // Per-alert-type integration routing
            fallbackToEmail?: boolean;
        };
    };
    subscriptionId?: ObjectId; // Reference to Subscription model
    usage: {
        currentMonth: {
            apiCalls: number;
            totalCost: number;
            totalTokens: number;
            optimizationsSaved: number;
        };
    };
    isActive: boolean;
    emailVerified: boolean;
    verificationToken?: string;
    resetPasswordToken?: string;
    resetPasswordExpires?: Date;
    lastLogin?: Date;
    country?: string; // ISO 3166-1 alpha-2 country code (e.g., 'IN', 'US', 'GB')
    mfa: {
        enabled: boolean;
        methods: Array<'email' | 'totp'>;
        email: {
            enabled: boolean;
            code?: string;
            codeExpires?: Date;
            attempts: number;
            lastAttempt?: Date;
        };
        totp: {
            enabled: boolean;
            secret?: string;
            backupCodes: string[];
            lastUsed?: Date;
        };
        trustedDevices: Array<{
            deviceId: string;
            deviceName: string;
            userAgent: string;
            ipAddress: string;
            createdAt: Date;
            lastUsed: Date;
            expiresAt: Date;
        }>;
    };
    onboarding: {
        completed: boolean;
        completedAt?: Date;
        projectCreated: boolean;
        firstLlmCall: boolean;
        stepsCompleted: string[];
    };
    accountClosure: {
        status: 'active' | 'pending_deletion' | 'deleted';
        requestedAt?: Date;
        scheduledDeletionAt?: Date;
        deletionToken?: string;
        confirmationStatus: {
            passwordConfirmed: boolean;
            emailConfirmed: boolean;
            cooldownCompleted: boolean;
        };
        cooldownStartedAt?: Date;
        reason?: string;
        reactivationCount: number;
    };
    createdAt: Date;
    updatedAt: Date;
    comparePassword(candidatePassword: string): Promise<boolean>;
}

const userSchema = new Schema<IUser>({
    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true,
    },
    password: {
        type: String,
        required: true,
        minlength: 8,
    },
    name: {
        type: String,
        required: true,
        trim: true,
    },
    avatar: {
        type: String,
    },
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    workspaceId: {
        type: Schema.Types.ObjectId,
        ref: 'Workspace',
    },
    workspaceMemberships: [{
        workspaceId: {
            type: Schema.Types.ObjectId,
            ref: 'Workspace',
            required: true,
        },
        role: {
            type: String,
            enum: ['owner', 'admin', 'developer', 'viewer'],
            required: true,
        },
        joinedAt: {
            type: Date,
            default: Date.now,
        },
    }],
    otherEmails: [{
        email: {
            type: String,
            required: true,
            lowercase: true,
            trim: true,
        },
        verified: {
            type: Boolean,
            default: false,
        },
        verificationToken: String,
        addedAt: {
            type: Date,
            default: Date.now,
        },
    }],
    dashboardApiKeys: [{
        name: {
            type: String,
            required: true,
            trim: true,
        },
        keyId: {
            type: String,
        },
        encryptedKey: {
            type: String,
            required: true,
        },
        maskedKey: {
            type: String,
            required: true,
        },
        permissions: [{
            type: String,
            enum: ['read', 'write', 'admin'],
            default: 'read',
        }],
        lastUsed: Date,
        createdAt: {
            type: Date,
            default: Date.now,
        },
        expiresAt: Date,
        isActive: {
            type: Boolean,
            default: true,
        },
    }],
    apiKeys: [{
        id: {
            type: String,
            required: true,
        },
        name: {
            type: String,
            required: true,
            trim: true,
        },
        key: {
            type: String,
            required: true,
        },
        created: {
            type: Date,
            default: Date.now,
        },
        lastUsed: Date,
        isActive: {
            type: Boolean,
            default: true,
        },
    }],
    preferences: {
        emailAlerts: {
            type: Boolean,
            default: true,
        },
        enableSessionReplay: {
            type: Boolean,
            default: false,
        },
        sessionReplayTimeout: {
            type: Number,
            default: 30, // minutes
        },
        alertThreshold: {
            type: Number,
            default: 100,
        },
        optimizationSuggestions: {
            type: Boolean,
            default: true,
        },
        maxConcurrentUserSessions: {
            type: Number,
            default: 10,
        },
        userSessionNotificationEnabled: {
            type: Boolean,
            default: true,
        },
        lastDigestSent: Date,
        emailEngagement: {
            totalSent: {
                type: Number,
                default: 0
            },
            totalOpened: {
                type: Number,
                default: 0
            },
            totalClicked: {
                type: Number,
                default: 0
            },
            lastOpened: Date,
            consecutiveIgnored: {
                type: Number,
                default: 0
            }
        },
        integrations: {
            defaultChannels: [{
                type: String
            }],
            alertTypeRouting: {
                type: Map,
                of: [String],
                default: new Map()
            },
            fallbackToEmail: {
                type: Boolean,
                default: true
            }
        }
    },
    subscriptionId: {
        type: Schema.Types.ObjectId,
        ref: 'Subscription',
        index: true,
    },
    usage: {
        currentMonth: {
            apiCalls: {
                type: Number,
                default: 0,
            },
            totalCost: {
                type: Number,
                default: 0,
            },
            totalTokens: {
                type: Number,
                default: 0,
            },
            optimizationsSaved: {
                type: Number,
                default: 0,
            },
        },
    },
    isActive: {
        type: Boolean,
        default: true,
    },
    emailVerified: {
        type: Boolean,
        default: false,
    },
    verificationToken: String,
    resetPasswordToken: String,
    resetPasswordExpires: Date,
    lastLogin: Date,
    country: {
        type: String,
        uppercase: true,
        trim: true,
        maxlength: 2, // ISO 3166-1 alpha-2 country code
    },
    mfa: {
        enabled: {
            type: Boolean,
            default: false,
        },
        methods: [{
            type: String,
            enum: ['email', 'totp'],
        }],
        email: {
            enabled: {
                type: Boolean,
                default: false,
            },
            code: String,
            codeExpires: Date,
            attempts: {
                type: Number,
                default: 0,
            },
            lastAttempt: Date,
        },
        totp: {
            enabled: {
                type: Boolean,
                default: false,
            },
            secret: String,
            backupCodes: [{
                type: String,
            }],
            lastUsed: Date,
        },
        trustedDevices: [{
            deviceId: {
                type: String,
                required: true,
            },
            deviceName: {
                type: String,
                required: true,
            },
            userAgent: {
                type: String,
                required: true,
            },
            ipAddress: {
                type: String,
                required: true,
            },
            createdAt: {
                type: Date,
                default: Date.now,
            },
            lastUsed: {
                type: Date,
                default: Date.now,
            },
            expiresAt: {
                type: Date,
                required: true,
            },
        }],
    },
    onboarding: {
        completed: {
            type: Boolean,
            default: false,
        },
        completedAt: Date,
        skipped: {
            type: Boolean,
            default: false,
        },
        skippedAt: Date,
        projectCreated: {
            type: Boolean,
            default: false,
        },
        firstLlmCall: {
            type: Boolean,
            default: false,
        },
        stepsCompleted: [{
            type: String,
        }],
    },
    accountClosure: {
        status: {
            type: String,
            enum: ['active', 'pending_deletion', 'deleted'],
            default: 'active',
        },
        requestedAt: Date,
        scheduledDeletionAt: Date,
        deletionToken: String,
        confirmationStatus: {
            passwordConfirmed: {
                type: Boolean,
                default: false,
            },
            emailConfirmed: {
                type: Boolean,
                default: false,
            },
            cooldownCompleted: {
                type: Boolean,
                default: false,
            },
        },
        cooldownStartedAt: Date,
        reason: String,
        reactivationCount: {
            type: Number,
            default: 0,
        },
    },
}, {
    timestamps: true,
});

// Hash password before saving
userSchema.pre('save', async function (next) {
    if (!this.isModified('password')) return next();

    try {
        const salt = await bcrypt.genSalt(10);
        this.password = await bcrypt.hash(this.password, salt);
        next();
    } catch (error: any) {
        next(error);
    }
});

// Compare password method
userSchema.methods.comparePassword = async function (candidatePassword: string): Promise<boolean> {
    return bcrypt.compare(candidatePassword, this.password);
};

// Add a method to reset monthly usage
userSchema.methods.resetMonthlyUsage = async function () {
    this.usage.currentMonth = {
        apiCalls: 0,
        totalCost: 0,
        totalTokens: 0,
        optimizationsSaved: 0
    };
    await this.save();
};

// Add a static method to reset all users' monthly usage
userSchema.statics.resetAllMonthlyUsage = async function () {
    await this.updateMany(
        {},
        {
            $set: {
                'usage.currentMonth': {
                    apiCalls: 0,
                    totalCost: 0,
                    totalTokens: 0,
                    optimizationsSaved: 0
                }
            }
        }
    );
};

// Virtual populate for subscription
userSchema.virtual('subscription', {
    ref: 'Subscription',
    localField: 'subscriptionId',
    foreignField: '_id',
    justOne: true,
});

// Indexes
userSchema.index({ subscriptionId: 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'dashboardApiKeys.keyId': 1, '_id': 1 });
userSchema.index({ 'otherEmails.email': 1 });
userSchema.index({ workspaceId: 1 });
userSchema.index({ 'workspaceMemberships.workspaceId': 1 });

export const User = mongoose.model<IUser>('User', userSchema);