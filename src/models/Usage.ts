import mongoose, { Schema } from 'mongoose';

export interface IUsage {
    _id?: any;
    userId: mongoose.Types.ObjectId;
    projectId?: mongoose.Types.ObjectId;
    service: 'openai' | 'aws-bedrock' | 'google-ai' | 'anthropic' | 'huggingface' | 'cohere' | 'dashboard-analytics' | string;
    model: string;
    prompt: string;
    completion?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost: number;
    responseTime: number;
    metadata: {
        requestId?: string;
        endpoint?: string;
        temperature?: number;
        maxTokens?: number;
        topP?: number;
        frequencyPenalty?: number;
        presencePenalty?: number;
        promptTemplateId?: mongoose.Types.ObjectId;
        [key: string]: any;
    };
    tags: string[];
    costAllocation?: {
        department?: string;
        team?: string;
        purpose?: string;
        client?: string;
        [key: string]: any;
    };
    optimizationApplied: boolean;
    optimizationId?: mongoose.Types.ObjectId;
    errorOccurred: boolean;
    errorMessage?: string;
    // Enhanced error tracking
    httpStatusCode?: number;
    errorType?: 'client_error' | 'server_error' | 'network_error' | 'auth_error' | 'rate_limit' | 'timeout' | 'validation_error' | 'integration_error';
    errorDetails?: {
        code?: string;
        type?: string;
        statusText?: string;
        requestId?: string;
        timestamp?: Date;
        endpoint?: string;
        method?: string;
        userAgent?: string;
        clientVersion?: string;
        [key: string]: any;
    };
    isClientError?: boolean; // Quick flag for 4xx errors
    isServerError?: boolean; // Quick flag for 5xx errors
    ipAddress?: string;
    userAgent?: string;
    traceId?: string;
    traceName?: string;
    traceStep?: string;
    traceSequence?: number;
    // Automation platform tracking
    automationPlatform?: 'zapier' | 'make' | 'n8n';
    automationConnectionId?: string;
    // Orchestration overhead tracking
    orchestrationCost?: number; // Cost of automation platform itself (run fees, data ops, etc.)
    orchestrationOverheadPercentage?: number; // Percentage of total cost that is orchestration overhead
    // Template usage tracking
    templateUsage?: {
        templateId: mongoose.Types.ObjectId;
        templateName: string;
        templateCategory: string;
        variablesResolved: Array<{
            variableName: string;
            value: string; // truncated if sensitive
            confidence: number;
            source: 'user_provided' | 'context_inferred' | 'default' | 'missing';
            reasoning?: string;
        }>;
        context: 'chat' | 'optimization' | 'visual-compliance' | 'agent_trace' | 'api';
        templateVersion?: number;
    };
    createdAt: Date;
    updatedAt: Date;
    // Email fields for user and customer identification
    userEmail?: string;
    customerEmail?: string;
    
    // NEW: Comprehensive Request/Response Tracking (extends existing fields)
    requestTracking?: {
        clientInfo: {
            ip: string;
            port?: number;
            forwardedIPs: string[];
            userAgent: string;
            geoLocation?: {
                country: string;
                region: string;
                city: string;
            };
            sdkVersion?: string;
            environment?: string;
        };
        
        headers: {
            request: Record<string, string>;
            response: Record<string, string>;
        };
        
        networking: {
            serverEndpoint: string;
            serverFullUrl?: string;
            clientOrigin?: string;
            serverIP: string;
            serverPort: number;
            routePattern: string;
            protocol: string;
            secure: boolean;
            dnsLookupTime?: number;
            tcpConnectTime?: number;
            tlsHandshakeTime?: number;
        };
        
        payload: {
            requestBody?: any; // Sanitized/truncated as needed
            responseBody?: any; // Sanitized/truncated as needed
            requestSize: number;
            responseSize: number;
            contentType: string;
            encoding?: string;
            compressionRatio?: number;
        };
        
        performance: {
            clientSideTime?: number; // Time on client before sending
            networkTime: number; // Time spent in network transit
            serverProcessingTime: number; // Time spent processing on server
            totalRoundTripTime: number;
            dataTransferEfficiency: number; // Bytes per second
        };
    };
    
    // NEW: Optimization Opportunities (linked to existing cost field)
    optimizationOpportunities?: {
        costOptimization: {
            potentialSavings: number;
            recommendedModel?: string;
            reasonCode: 'model_downgrade' | 'prompt_optimization' | 'caching' | 'batch_processing';
            confidence: number;
            estimatedImpact: string;
        };
        
        performanceOptimization: {
            currentPerformanceScore: number; // 0-100
            bottleneckIdentified: 'network' | 'processing' | 'payload_size' | 'model_complexity';
            recommendation: string;
            estimatedImprovement: string;
        };
        
        dataEfficiency: {
            compressionRecommendation?: boolean;
            payloadOptimization?: string;
            headerOptimization?: string;
        };
    };
}

const usageSchema = new Schema<IUsage>({
    userId: {
        type: Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    projectId: {
        type: Schema.Types.ObjectId,
        ref: 'Project'
    },
    service: {
        type: String,
        enum: ['openai', 'aws-bedrock', 'google-ai', 'anthropic', 'huggingface', 'cohere', 'dashboard-analytics'],
        required: true
    },
    model: {
        type: String,
        required: true
    },
    prompt: {
        type: String,
        default: ''
    },
    completion: String,
    promptTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    completionTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    totalTokens: {
        type: Number,
        required: true,
        min: 0,
    },
    cost: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    responseTime: {
        type: Number,
        required: true,
        min: 0,
        default: 0
    },
    metadata: {
        type: Schema.Types.Mixed,
        default: {},
    },
    tags: [{
        type: String,
        trim: true,
    }],
    costAllocation: {
        type: Schema.Types.Mixed,
        default: {}
    },
    optimizationApplied: {
        type: Boolean,
        default: false,
    },
    optimizationId: {
        type: Schema.Types.ObjectId,
        ref: 'Optimization',
    },
    errorOccurred: {
        type: Boolean,
        default: false,
    },
    errorMessage: String,
    // Enhanced error tracking schema
    httpStatusCode: {
        type: Number,
        min: 100,
        max: 599
    },
    errorType: {
        type: String,
        enum: ['client_error', 'server_error', 'network_error', 'auth_error', 'rate_limit', 'timeout', 'validation_error', 'integration_error']
    },
    errorDetails: {
        type: Schema.Types.Mixed,
        default: {}
    },
    isClientError: {
        type: Boolean,
        default: false
    },
    isServerError: {
        type: Boolean,
        default: false
    },
    // Email fields for user and customer identification
    userEmail: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true
    },
    customerEmail: {
        type: String,
        trim: true,
        lowercase: true,
        sparse: true
    },
    ipAddress: String,
    userAgent: String,
    // Agent trace tracking fields
    traceId: {
        type: String
    },
    traceName: {
        type: String
    },
    traceStep: {
        type: String
    },
    traceSequence: {
        type: Number,
        min: 0
    },
    // Automation platform tracking schema
    automationPlatform: {
        type: String,
        enum: ['zapier', 'make', 'n8n']
    },
    automationConnectionId: {
        type: String,
        ref: 'AutomationConnection'
    },
    // Orchestration overhead tracking schema
    orchestrationCost: {
        type: Number,
        min: 0,
        default: 0
    },
    orchestrationOverheadPercentage: {
        type: Number,
        min: 0,
        max: 100
    },
    // Template usage tracking schema
    templateUsage: {
        templateId: {
            type: Schema.Types.ObjectId,
            ref: 'PromptTemplate'
        },
        templateName: String,
        templateCategory: {
            type: String,
            enum: ['general', 'coding', 'writing', 'analysis', 'creative', 'business', 'custom', 'visual-compliance']
        },
        variablesResolved: [{
            variableName: String,
            value: String,
            confidence: Number,
            source: {
                type: String,
                enum: ['user_provided', 'context_inferred', 'default', 'missing']
            },
            reasoning: String
        }],
        context: {
            type: String,
            enum: ['chat', 'optimization', 'visual-compliance', 'agent_trace', 'api']
    },
    templateVersion: Number
},
// NEW: Comprehensive Request/Response Tracking Schema
requestTracking: {
    clientInfo: {
        ip: String,
        port: Number,
        forwardedIPs: [String],
        userAgent: String,
        geoLocation: {
            country: String,
            region: String,
            city: String
        },
        sdkVersion: String,
        environment: String
    },
    
    headers: {
        request: {
            type: Schema.Types.Mixed,
            default: {}
        },
        response: {
            type: Schema.Types.Mixed,
            default: {}
        }
    },
    
    networking: {
        serverEndpoint: String,
        serverFullUrl: String,
        clientOrigin: String,
        serverIP: String,
        serverPort: Number,
        routePattern: String,
        protocol: String,
        secure: Boolean,
        dnsLookupTime: Number,
        tcpConnectTime: Number,
        tlsHandshakeTime: Number
    },
    
    payload: {
        requestBody: Schema.Types.Mixed,
        responseBody: Schema.Types.Mixed,
        requestSize: {
            type: Number,
            min: 0,
            default: 0
        },
        responseSize: {
            type: Number,
            min: 0,
            default: 0
        },
        contentType: String,
        encoding: String,
        compressionRatio: Number
    },
    
    performance: {
        clientSideTime: Number,
        networkTime: {
            type: Number,
            min: 0,
            default: 0
        },
        serverProcessingTime: {
            type: Number,
            min: 0,
            default: 0
        },
        totalRoundTripTime: {
            type: Number,
            min: 0,
            default: 0
        },
        dataTransferEfficiency: {
            type: Number,
            min: 0,
            default: 0
        }
    }
},

// NEW: Optimization Opportunities Schema
optimizationOpportunities: {
    costOptimization: {
        potentialSavings: {
            type: Number,
            min: 0,
            default: 0
        },
        recommendedModel: String,
        reasonCode: {
            type: String,
            enum: ['model_downgrade', 'prompt_optimization', 'caching', 'batch_processing']
        },
        confidence: {
            type: Number,
            min: 0,
            max: 1,
            default: 0
        },
        estimatedImpact: String
    },
    
    performanceOptimization: {
        currentPerformanceScore: {
            type: Number,
            min: 0,
            max: 100,
            default: 0
        },
        bottleneckIdentified: {
            type: String,
            enum: ['network', 'processing', 'payload_size', 'model_complexity']
        },
        recommendation: String,
        estimatedImprovement: String
    },
    
    dataEfficiency: {
        compressionRecommendation: Boolean,
        payloadOptimization: String,
        headerOptimization: String
    }
}
}, {
    timestamps: true,
});

// 1. Primary user queries (most common)
usageSchema.index({ userId: 1, createdAt: -1 });

// 2. Time-based queries
usageSchema.index({ createdAt: -1 });

// 3. Service filtering
usageSchema.index({ service: 1, createdAt: -1 });

// 4. Cost analysis
usageSchema.index({ cost: -1 });

// 5. Error tracking (only if actually used)
usageSchema.index({ errorOccurred: 1, createdAt: -1 });

// 6. Text search for prompts (if needed)
usageSchema.index({ prompt: 'text', completion: 'text' });

// 7. Template usage tracking
usageSchema.index({ 'templateUsage.templateId': 1, createdAt: -1 });
usageSchema.index({ 'templateUsage.context': 1, createdAt: -1 });
usageSchema.index({ userId: 1, 'templateUsage.templateId': 1, createdAt: -1 });

// 8. Automation platform tracking
usageSchema.index({ automationPlatform: 1, createdAt: -1 });
usageSchema.index({ automationConnectionId: 1, createdAt: -1 });
usageSchema.index({ userId: 1, automationPlatform: 1, createdAt: -1 });
usageSchema.index({ traceId: 1, automationPlatform: 1, createdAt: -1 });

// 9. Comprehensive tracking indexes
usageSchema.index({ 'requestTracking.clientInfo.ip': 1, createdAt: -1 });
usageSchema.index({ 'requestTracking.networking.serverEndpoint': 1, createdAt: -1 });
usageSchema.index({ 'requestTracking.performance.serverProcessingTime': -1 });
usageSchema.index({ 'requestTracking.performance.totalRoundTripTime': -1 });
usageSchema.index({ 'optimizationOpportunities.costOptimization.potentialSavings': -1 });
usageSchema.index({ 'optimizationOpportunities.performanceOptimization.currentPerformanceScore': 1 });

// Virtual for cost per token
usageSchema.virtual('costPerToken').get(function () {
    return this.totalTokens > 0 ? this.cost / this.totalTokens : 0;
});

// Static method to get usage summary for a user
usageSchema.statics.getUserSummary = async function (userId: string, startDate?: Date, endDate?: Date) {
    const match: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = startDate;
        if (endDate) match.createdAt.$lte = endDate;
    }

    return this.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalTokens: { $sum: '$totalTokens' },
                totalCalls: { $sum: 1 },
                avgCost: { $avg: '$cost' },
                avgTokens: { $avg: '$totalTokens' },
                avgResponseTime: { $avg: '$responseTime' },
            }
        }
    ]);
};

// Static method to get enhanced usage summary with comprehensive tracking
usageSchema.statics.getEnhancedUserSummary = async function (userId: string, startDate?: Date, endDate?: Date) {
    const match: any = { userId: new mongoose.Types.ObjectId(userId) };

    if (startDate || endDate) {
        match.createdAt = {};
        if (startDate) match.createdAt.$gte = startDate;
        if (endDate) match.createdAt.$lte = endDate;
    }

    return this.aggregate([
        { $match: match },
        {
            $group: {
                _id: null,
                totalCost: { $sum: '$cost' },
                totalTokens: { $sum: '$totalTokens' },
                totalCalls: { $sum: 1 },
                avgCost: { $avg: '$cost' },
                avgTokens: { $avg: '$totalTokens' },
                avgResponseTime: { $avg: '$responseTime' },
                
                // NEW: Network performance metrics
                avgNetworkTime: { $avg: '$requestTracking.performance.networkTime' },
                avgServerProcessingTime: { $avg: '$requestTracking.performance.serverProcessingTime' },
                avgTotalRoundTripTime: { $avg: '$requestTracking.performance.totalRoundTripTime' },
                
                // NEW: Data transfer metrics
                totalRequestSize: { $sum: '$requestTracking.payload.requestSize' },
                totalResponseSize: { $sum: '$requestTracking.payload.responseSize' },
                avgDataTransferEfficiency: { $avg: '$requestTracking.performance.dataTransferEfficiency' },
                
                // NEW: Optimization metrics
                totalPotentialSavings: { $sum: '$optimizationOpportunities.costOptimization.potentialSavings' },
                avgPerformanceScore: { $avg: '$optimizationOpportunities.performanceOptimization.currentPerformanceScore' },
                optimizationOpportunityCount: {
                    $sum: {
                        $cond: [{ $gt: ['$optimizationOpportunities.costOptimization.potentialSavings', 0] }, 1, 0]
                    }
                }
            }
        }
    ]);
};

export const Usage = mongoose.model<IUsage>('Usage', usageSchema);