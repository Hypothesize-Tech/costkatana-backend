import mongoose, { Document, Schema } from 'mongoose';

// Integration types for external AI tools
export const INTEGRATION_TYPES = {
    CHATGPT: 'chatgpt',
    CURSOR: 'cursor',
    NPMJS: 'npmjs',
    PYTHON_CLI: 'python-cli',
    JAVASCRIPT_CLI: 'javascript-cli',
    CLAUDE: 'claude',
    OTHER: 'other'
} as const;

// App feature types for in-app usage
export const APP_FEATURES = {
    CHAT: 'chat',
    EXPERIMENTATION: 'experimentation',
    MODEL_COMPARISON: 'model-comparison',
    WHAT_IF_SIMULATOR: 'what-if-simulator',
    PROMPT_OPTIMIZER: 'prompt-optimizer',
    COST_ANALYZER: 'cost-analyzer',
    OTHER: 'other'
} as const;

export interface ISession extends Document {
    sessionId: string;
    userId?: string;
    label?: string;
    startedAt: Date;
    endedAt?: Date;
    status: 'active' | 'completed' | 'error';
    source?: 'telemetry' | 'manual' | 'unified' | 'in-app' | 'integration';
    telemetryTraceId?: string;
    workspaceId?: string;
    trackingEnabled?: boolean;
    sessionReplayEnabled?: boolean;
    trackingEnabledAt?: Date;
    duration?: number;
    hasErrors?: boolean;
    errorCount?: number;
    integrationName?: string; // Use INTEGRATION_TYPES values
    appFeature?: string; // Use APP_FEATURES values
    trackingHistory?: Array<{
        enabled: boolean;
        sessionReplayEnabled: boolean;
        timestamp: Date;
        request?: {
            model: string;
            tokens: number;
            cost: number;
        };
        context?: {
            files?: string[];
            workspace?: any;
        };
    }>;
    replayData?: {
        codeContext?: Array<{
            filePath: string;
            content: string;
            language?: string;
            timestamp: Date;
        }>;
        workspaceState?: {
            environment?: Record<string, any>;
            settings?: Record<string, any>;
            activeFiles?: string[];
            projectStructure?: any;
        };
        aiInteractions?: Array<{
            timestamp: Date;
            model: string;
            prompt: string;
            response: string;
            parameters?: {
                temperature?: number;
                maxTokens?: number;
                topP?: number;
                [key: string]: any;
            };
            tokens?: {
                input: number;
                output: number;
            };
            cost?: number;
            latency?: number;
            provider?: string;
            requestMetadata?: Record<string, any>;
            responseMetadata?: Record<string, any>;
        }>;
        userActions?: Array<{
            timestamp: Date;
            action: string;
            details?: any;
        }>;
        systemMetrics?: Array<{
            timestamp: Date;
            cpu?: number;
            memory?: number;
            network?: {
                sent: number;
                received: number;
            };
        }>;
    };
    metadata?: Record<string, any>;
    error?: {
        message: string;
        stack?: string;
    };
    summary?: {
        totalSpans: number;
        totalDuration?: number;
        totalCost?: number;
        totalTokens?: {
            input: number;
            output: number;
        };
    };
    createdAt: Date;
    updatedAt: Date;
}

const SessionSchema = new Schema<ISession>(
    {
        sessionId: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        userId: {
            type: String,
            index: true
        },
        label: {
            type: String,
            index: true
        },
        startedAt: {
            type: Date,
            required: true,
            index: true
        },
        endedAt: {
            type: Date
        },
        status: {
            type: String,
            enum: ['active', 'completed', 'error'],
            default: 'active',
            index: true
        },
        source: {
            type: String,
            enum: ['telemetry', 'manual', 'unified', 'in-app', 'integration'],
            default: 'manual',
            index: true
        },
        telemetryTraceId: {
            type: String,
            index: true
        },
        workspaceId: {
            type: String,
            index: true
        },
        trackingEnabled: {
            type: Boolean,
            default: false
        },
        sessionReplayEnabled: {
            type: Boolean,
            default: false
        },
        trackingEnabledAt: {
            type: Date
        },
        duration: {
            type: Number
        },
        hasErrors: {
            type: Boolean,
            default: false,
            index: true
        },
        errorCount: {
            type: Number,
            default: 0
        },
        integrationName: {
            type: String
        },
        appFeature: {
            type: String,
            index: true
        },
        trackingHistory: [{
            enabled: Boolean,
            sessionReplayEnabled: Boolean,
            timestamp: Date,
            request: {
                model: String,
                tokens: Number,
                cost: Number
            },
            context: {
                files: [String],
                workspace: Schema.Types.Mixed
            }
        }],
        replayData: {
            codeContext: [{
                filePath: String,
                content: String,
                language: String,
                timestamp: Date
            }],
            workspaceState: {
                environment: Schema.Types.Mixed,
                settings: Schema.Types.Mixed,
                activeFiles: [String],
                projectStructure: Schema.Types.Mixed
            },
            aiInteractions: [{
                timestamp: Date,
                model: String,
                prompt: String,
                response: String,
                parameters: Schema.Types.Mixed,
                tokens: {
                    input: Number,
                    output: Number
                },
                cost: Number,
                latency: Number
            }],
            userActions: [{
                timestamp: Date,
                action: String,
                details: Schema.Types.Mixed
            }],
            systemMetrics: [{
                timestamp: Date,
                cpu: Number,
                memory: Number,
                network: {
                    sent: Number,
                    received: Number
                }
            }]
        },
        metadata: {
            type: Schema.Types.Mixed
        },
        error: {
            message: String,
            stack: String
        },
        summary: {
            totalSpans: {
                type: Number,
                default: 0
            },
            totalDuration: Number,
            totalCost: Number,
            totalTokens: {
                input: {
                    type: Number,
                    default: 0
                },
                output: {
                    type: Number,
                    default: 0
                }
            }
        }
    },
    {
        timestamps: true
    }
);

// Compound indexes for efficient queries
SessionSchema.index({ userId: 1, startedAt: -1 });
SessionSchema.index({ label: 1, startedAt: -1 });
SessionSchema.index({ status: 1, startedAt: -1 });
SessionSchema.index({ userId: 1, startedAt: -1, source: 1 });
SessionSchema.index({ userId: 1, workspaceId: 1, updatedAt: -1 });
// New indexes for advanced filtering
SessionSchema.index({ userId: 1, source: 1, startedAt: -1 });
SessionSchema.index({ userId: 1, hasErrors: 1, startedAt: -1 });
SessionSchema.index({ userId: 1, 'summary.totalCost': 1, startedAt: -1 });
SessionSchema.index({ appFeature: 1, userId: 1, startedAt: -1 });

// TTL index if enabled
if (process.env.TRACE_TTL_DAYS) {
    const ttlDays = parseInt(process.env.TRACE_TTL_DAYS);
    SessionSchema.index({ createdAt: 1 }, { expireAfterSeconds: ttlDays * 24 * 60 * 60 });
}

export const Session = mongoose.model<ISession>('Session', SessionSchema);
