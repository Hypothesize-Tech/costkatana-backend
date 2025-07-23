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
        weeklyReports: boolean;
        optimizationSuggestions: boolean;
        lastDigestSent?: Date;
    };
    subscription: {
        plan: 'free' | 'pro' | 'enterprise';
        startDate: Date;
        endDate?: Date;
        limits: {
            apiCalls: number;
            optimizations: number;
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
            required: true,
            unique: true,
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
        weeklyReports: {
            type: Boolean,
            default: true,
        },
        optimizationSuggestions: {
            type: Boolean,
            default: true,
        },
        lastDigestSent: Date,
    },
    subscription: {
        plan: {
            type: String,
            enum: ['free', 'pro', 'enterprise'],
            default: 'free',
        },
        startDate: {
            type: Date,
            default: Date.now,
        },
        endDate: Date,
        limits: {
            apiCalls: {
                type: Number,
                default: 1000,
            },
            optimizations: {
                type: Number,
                default: 10,
            },
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

export const User = mongoose.model<IUser>('User', userSchema);