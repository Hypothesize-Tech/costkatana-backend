import mongoose, { Document, Schema } from 'mongoose';

// User Memory Model - Stores general user memory and insights
export interface IUserMemory extends Document {
    userId: string;
    memoryType: 'preference' | 'pattern' | 'security' | 'context' | 'insight';
    content: string;
    confidence: number;
    source: string;
    tags: string[];
    metadata: any;
    isActive: boolean;
    expiresAt?: Date;
    createdAt: Date;
    updatedAt: Date;
}

const UserMemorySchema = new Schema<IUserMemory>({
    userId: {
        type: String,
        required: true
    },
    memoryType: {
        type: String,
        enum: ['preference', 'pattern', 'security', 'context', 'insight'],
        required: true
    },
    content: {
        type: String,
        required: true,
        maxlength: 5000
    },
    confidence: {
        type: Number,
        required: true,
        min: 0,
        max: 1
    },
    source: {
        type: String,
        required: true,
        maxlength: 100
    },
    tags: [{
        type: String,
        maxlength: 50
    }],
    metadata: {
        type: Schema.Types.Mixed,
        default: {}
    },
    isActive: {
        type: Boolean,
        default: true
    },
    expiresAt: {
        type: Date
    }
}, {
    timestamps: true
});

// Compound indexes for efficient queries
UserMemorySchema.index({ userId: 1, memoryType: 1, isActive: 1 });

// Conversation Memory Model - Stores individual conversations for similarity search
export interface IConversationMemory extends Document {
    userId: string;
    conversationId: string;
    query: string;
    response: string;
    queryEmbedding?: number[]; // For vector similarity (optional, using in-memory for now)
    metadata: {
        timestamp: Date;
        modelUsed?: string;
        chatMode?: string;
        cost?: number;
        responseTime?: number;
        queryLength: number;
        responseLength: number;
        topics?: string[];
        sentiment?: string;
        userSatisfaction?: number;
        [key: string]: any;
    };
    isArchived: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const ConversationMemorySchema = new Schema<IConversationMemory>({
    userId: {
        type: String,
        required: true
    },
    conversationId: {
        type: String,
        required: true
    },
    query: {
        type: String,
        required: true,
        maxlength: 10000
    },
    response: {
        type: String,
        required: true,
        maxlength: 50000
    },
    queryEmbedding: [{
        type: Number
    }],
    metadata: {
        timestamp: {
            type: Date,
            required: true
        },
        modelUsed: String,
        chatMode: {
            type: String,
            enum: ['fastest', 'cheapest', 'balanced']
        },
        cost: Number,
        responseTime: Number,
        queryLength: {
            type: Number,
            required: true
        },
        responseLength: {
            type: Number,
            required: true
        },
        topics: [String],
        sentiment: {
            type: String,
            enum: ['positive', 'neutral', 'negative']
        },
        userSatisfaction: {
            type: Number,
            min: 1,
            max: 5
        }
    },
    isArchived: {
        type: Boolean,
        default: false
    }
}, {
    timestamps: true
});

// User Preferences Model - Stores user preferences and learned behaviors
export interface IUserPreference extends Document {
    userId: string;
    preferredModel?: string;
    preferredChatMode?: 'fastest' | 'cheapest' | 'balanced';
    preferredStyle?: string;
    responseLength?: 'concise' | 'detailed' | 'comprehensive';
    technicalLevel?: 'beginner' | 'intermediate' | 'expert';
    commonTopics: string[];
    costPreference?: 'cheap' | 'balanced' | 'premium';
    
    // Learned preferences from interactions
    modelPerformanceRatings: Map<string, {
        rating: number;
        usageCount: number;
        lastUsed: Date;
    }>;
    
    topicInterests: Map<string, {
        frequency: number;
        lastMentioned: Date;
        sentiment: 'positive' | 'neutral' | 'negative';
    }>;
    
    // Notification preferences
    notificationPreferences: {
        email: boolean;
        push: boolean;
        sms: boolean;
        weeklyDigest: boolean;
        costAlerts: boolean;
        newFeatures: boolean;
    };
    
    // Privacy settings
    privacySettings: {
        shareData: boolean;
        trackUsage: boolean;
        personalizedRecommendations: boolean;
        retainConversations: boolean;
        allowModelTraining: boolean;
    };
    
    // Usage patterns
    usagePatterns: {
        peakHours: number[];
        averageSessionLength: number;
        preferredQueryTypes: string[];
        responseTimePreference: number; // in seconds
    };
    
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
}

const UserPreferenceSchema = new Schema<IUserPreference>({
    userId: {
        type: String,
        required: true,
        unique: true
    },
    preferredModel: {
        type: String,
        maxlength: 100
    },
    preferredChatMode: {
        type: String,
        enum: ['fastest', 'cheapest', 'balanced']
    },
    preferredStyle: {
        type: String,
        maxlength: 50
    },
    responseLength: {
        type: String,
        enum: ['concise', 'detailed', 'comprehensive'],
        default: 'detailed'
    },
    technicalLevel: {
        type: String,
        enum: ['beginner', 'intermediate', 'expert'],
        default: 'intermediate'
    },
    commonTopics: [{
        type: String,
        maxlength: 50
    }],
    costPreference: {
        type: String,
        enum: ['cheap', 'balanced', 'premium'],
        default: 'balanced'
    },
    
    modelPerformanceRatings: {
        type: Map,
        of: {
            rating: {
                type: Number,
                min: 1,
                max: 5
            },
            usageCount: {
                type: Number,
                default: 0
            },
            lastUsed: Date
        },
        default: {}
    },
    
    topicInterests: {
        type: Map,
        of: {
            frequency: {
                type: Number,
                default: 1
            },
            lastMentioned: Date,
            sentiment: {
                type: String,
                enum: ['positive', 'neutral', 'negative'],
                default: 'neutral'
            }
        },
        default: {}
    },
    
    notificationPreferences: {
        email: {
            type: Boolean,
            default: true
        },
        push: {
            type: Boolean,
            default: true
        },
        sms: {
            type: Boolean,
            default: false
        },
        weeklyDigest: {
            type: Boolean,
            default: true
        },
        costAlerts: {
            type: Boolean,
            default: true
        },
        newFeatures: {
            type: Boolean,
            default: true
        }
    },
    
    privacySettings: {
        shareData: {
            type: Boolean,
            default: false
        },
        trackUsage: {
            type: Boolean,
            default: true
        },
        personalizedRecommendations: {
            type: Boolean,
            default: true
        },
        retainConversations: {
            type: Boolean,
            default: true
        },
        allowModelTraining: {
            type: Boolean,
            default: false
        }
    },
    
    usagePatterns: {
        peakHours: [{
            type: Number,
            min: 0,
            max: 23
        }],
        averageSessionLength: {
            type: Number,
            default: 0
        },
        preferredQueryTypes: [String],
        responseTimePreference: {
            type: Number,
            default: 30 // 30 seconds default
        }
    },
    
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

UserPreferenceSchema.index({ userId: 1, isActive: 1 });
UserPreferenceSchema.index({ commonTopics: 1 });
UserPreferenceSchema.index({ preferredModel: 1 });

export interface IMemoryAnalytics extends Document {
    userId: string;
    analyticsType: 'daily' | 'weekly' | 'monthly';
    period: Date;
    
    conversationStats: {
        totalConversations: number;
        averageQueryLength: number;
        averageResponseLength: number;
        mostCommonTopics: string[];
        modelUsageDistribution: Map<string, number>;
        satisfactionScore: number;
    };
    
    behaviorPatterns: {
        peakUsageHours: number[];
        queryComplexityTrend: 'increasing' | 'decreasing' | 'stable';
        topicDiversityScore: number;
        engagementScore: number;
    };
    
    securityInsights: {
        suspiciousPatternCount: number;
        riskLevel: 'low' | 'medium' | 'high';
        flaggedQueries: number;
    };
    
    recommendations: string[];
    
    createdAt: Date;
    updatedAt: Date;
}

const MemoryAnalyticsSchema = new Schema<IMemoryAnalytics>({
    userId: {
        type: String,
        required: true
    },
    analyticsType: {
        type: String,
        enum: ['daily', 'weekly', 'monthly'],
        required: true
    },
    period: {
        type: Date,
        required: true
    },
    
    conversationStats: {
        totalConversations: {
            type: Number,
            default: 0
        },
        averageQueryLength: {
            type: Number,
            default: 0
        },
        averageResponseLength: {
            type: Number,
            default: 0
        },
        mostCommonTopics: [String],
        modelUsageDistribution: {
            type: Map,
            of: Number,
            default: {}
        },
        satisfactionScore: {
            type: Number,
            min: 1,
            max: 5,
            default: 3
        }
    },
    
    behaviorPatterns: {
        peakUsageHours: [Number],
        queryComplexityTrend: {
            type: String,
            enum: ['increasing', 'decreasing', 'stable'],
            default: 'stable'
        },
        topicDiversityScore: {
            type: Number,
            min: 0,
            max: 1,
            default: 0.5
        },
        engagementScore: {
            type: Number,
            min: 0,
            max: 1,
            default: 0.5
        }
    },
    
    securityInsights: {
        suspiciousPatternCount: {
            type: Number,
            default: 0
        },
        riskLevel: {
            type: String,
            enum: ['low', 'medium', 'high'],
            default: 'low'
        },
        flaggedQueries: {
            type: Number,
            default: 0
        }
    },
    
    recommendations: [String]
}, {
    timestamps: true
});

MemoryAnalyticsSchema.index({ userId: 1, analyticsType: 1, period: -1 });

export const UserMemory = mongoose.model<IUserMemory>('UserMemory', UserMemorySchema);
export const ConversationMemory = mongoose.model<IConversationMemory>('ConversationMemory', ConversationMemorySchema);
export const UserPreference = mongoose.model<IUserPreference>('UserPreference', UserPreferenceSchema);
export const MemoryAnalytics = mongoose.model<IMemoryAnalytics>('MemoryAnalytics', MemoryAnalyticsSchema);