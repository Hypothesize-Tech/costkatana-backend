import mongoose, { Schema } from 'mongoose';
import bcrypt from 'bcryptjs';

export interface IUser {
    email: string;
    password: string;
    name: string;
    role: 'user' | 'admin';
    apiKeys: Array<{
        service: string;
        key: string;
        encryptedKey?: string;
        addedAt: Date;
    }>;
    preferences: {
        emailAlerts: boolean;
        alertThreshold: number;
        weeklyReports: boolean;
        optimizationSuggestions: boolean;
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
    role: {
        type: String,
        enum: ['user', 'admin'],
        default: 'user',
    },
    apiKeys: [{
        service: {
            type: String,
            required: true,
        },
        key: {
            type: String,
            required: true,
        },
        encryptedKey: String,
        addedAt: {
            type: Date,
            default: Date.now,
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