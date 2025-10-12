import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser {
    email: string;
    password: string;
    name: string;
    avatar?: string;
    role: 'user' | 'admin';
    dashboardApiKeys: Array<{
        name: string;
        keyId: string;
        encryptedKey: string;
        maskedKey: string;
        permissions: string[];
        lastUsed?: Date;
        createdAt: Date;
        expiresAt?: Date;
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
        lastDigestSent?: Date;
        emailEngagement?: {
            totalSent: number;
            totalOpened: number;
            totalClicked: number;
            lastOpened?: Date;
            consecutiveIgnored: number;
        };
    };
    subscription: {
        plan: 'free' | 'plus' | 'pro' | 'enterprise';
        startDate: Date;
        endDate?: Date;
        seats?: number; // Number of seats for plus/pro plans
        limits: {
            apiCalls: number;
            optimizations: number;
            tokensPerMonth: number;
            logsPerMonth: number;
            projects: number;
            workflows: number;
        };
        billing?: {
            amount: number;
            currency: string;
            interval: 'monthly' | 'yearly';
            nextBillingDate?: Date;
        };
    };
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
        alertThreshold: {
            type: Number,
            default: 100,
        },
        optimizationSuggestions: {
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
        }
    },
    subscription: {
        plan: {
            type: String,
            enum: ['free', 'plus', 'pro', 'enterprise'],
            default: 'free',
        },
        startDate: {
            type: Date,
            default: Date.now,
        },
        endDate: Date,
        seats: {
            type: Number,
            default: 1,
        },
        limits: {
            apiCalls: {
                type: Number,
                default: 10000, // Free tier: 10K requests/month
            },
            optimizations: {
                type: Number,
                default: 10,
            },
            tokensPerMonth: {
                type: Number,
                default: 1000000, // Free tier: 1M tokens/month
            },
            logsPerMonth: {
                type: Number,
                default: 15000, // Free tier: 15K logs/month
            },
            projects: {
                type: Number,
                default: 5, // Free tier: 5 projects
            },
            workflows: {
                type: Number,
                default: 10, // Free tier: 10 workflows
            },
        },
        billing: {
            amount: {
                type: Number,
                default: 0,
            },
            currency: {
                type: String,
                default: 'USD',
            },
            interval: {
                type: String,
                enum: ['monthly', 'yearly'],
                default: 'monthly',
            },
            nextBillingDate: Date,
        },
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

// Indexes
userSchema.index({ 'subscription.plan': 1 });
userSchema.index({ createdAt: -1 });
userSchema.index({ 'dashboardApiKeys.keyId': 1, '_id': 1 }); 

export const User = mongoose.model<IUser>('User', userSchema);