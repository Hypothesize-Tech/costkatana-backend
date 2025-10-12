import { z } from 'zod';

// User validation schemas
export const registerSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(8, 'Password must be at least 8 characters'),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    confirmPassword: z.string().optional(),
}).refine((data) => !data.confirmPassword || data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
});

export const loginSchema = z.object({
    email: z.string().email('Invalid email address'),
    password: z.string().min(1, 'Password is required'),
});

export const updateProfileSchema = z.object({
    name: z.string().min(2).optional(),
    avatar: z.string().url().optional(),
    preferences: z.object({
        emailAlerts: z.boolean().optional(),
        alertThreshold: z.number().positive().optional(),
        optimizationSuggestions: z.boolean().optional(),
    }).optional(),
});

// Usage validation schemas
export const trackUsageSchema = z.object({
    service: z.enum(['openai', 'aws-bedrock', 'google-ai', 'anthropic', 'huggingface', 'cohere']),
    model: z.string().min(1, 'Model is required'),
    prompt: z.string().min(1, 'Prompt is required'),
    completion: z.string().optional(),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
    totalTokens: z.number().int().nonnegative(),
    cost: z.number().nonnegative(),
    responseTime: z.number().nonnegative(),
    metadata: z.record(z.any()).optional(),
    tags: z.array(z.string()).optional(),
    projectId: z.string().optional(),
});

export const sdkTrackUsageSchema = z.object({
    provider: z.enum(['openai', 'anthropic', 'aws-bedrock', 'google-ai', 'huggingface', 'cohere']).optional(),
    service: z.enum(['openai', 'anthropic', 'aws-bedrock', 'google-ai', 'huggingface', 'cohere']).optional(),
    model: z.string(),
    prompt: z.string().optional().default(''),
    completion: z.string().optional(),
    promptTokens: z.number().min(0),
    completionTokens: z.number().min(0),
    totalTokens: z.number().min(0).optional(),
    cost: z.number().min(0).optional(),
    estimatedCost: z.number().min(0).optional(),
    responseTime: z.number().min(0).optional().default(0),
    metadata: z.object({}).optional().default({}),
    tags: z.array(z.string()).optional().default([]),
    projectId: z.string().optional(),
    // Workflow tracking fields
    workflowId: z.string().optional(),
    workflowName: z.string().optional(),
    workflowStep: z.string().optional(),
    workflowSequence: z.number().min(0).optional(),
    // Email fields for user and customer identification
    userEmail: z.string().email().optional(),
    customerEmail: z.string().email().optional(),
    // Enhanced request/response data
    messages: z.array(z.object({
        role: z.enum(['system', 'user', 'assistant']),
        content: z.string()
    })).optional(),
    system: z.string().optional(),
    input: z.string().optional(),
    output: z.string().optional(),
    // Enhanced metadata for comprehensive tracking
    requestMetadata: z.object({
        messages: z.array(z.object({
            role: z.enum(['system', 'user', 'assistant']),
            content: z.string()
        })).optional(),
        system: z.string().optional(),
        input: z.string().optional(),
        prompt: z.string().optional()
    }).optional(),
    responseMetadata: z.object({
        completion: z.string().optional(),
        output: z.string().optional(),
        choices: z.array(z.object({
            message: z.object({
                content: z.string(),
                role: z.string()
            }).optional(),
            text: z.string().optional()
        })).optional()
    }).optional()
}).refine(
    (data) => data.provider || data.service,
    { message: "Either 'provider' or 'service' must be provided" }
);

// Analytics validation schemas
export const analyticsQuerySchema = z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }).optional(),
    period: z.enum(['daily', 'weekly', 'monthly']).optional(),
    service: z.string().optional(),
    model: z.string().optional(),
    groupBy: z.enum(['service', 'model', 'date', 'hour']).optional(),
    projectId: z.string().optional(),
});

// Optimization validation schemas
export const optimizationRequestSchema = z.object({
    prompt: z.string().min(1, 'Prompt is required'),
    service: z.string().min(1, 'Service is required'),
    model: z.string().min(1, 'Model is required'),
    context: z.string().optional(),
    options: z.object({
        targetReduction: z.number().min(0).max(100).optional(),
        preserveIntent: z.boolean().optional(),
        suggestAlternatives: z.boolean().optional(),
    }).optional(),
    
    // 🚀 CORTEX VALIDATION PARAMETERS
    enableCortex: z.boolean().optional(),
    cortexOperation: z.enum(['optimize', 'compress', 'analyze', 'transform', 'sast', 'answer']).optional(),
    cortexEncodingModel: z.string().optional(),
    cortexCoreModel: z.string().optional(),
    cortexDecodingModel: z.string().optional(),
    cortexStyle: z.enum(['formal', 'casual', 'technical', 'conversational']).optional(),
    cortexFormat: z.enum(['plain', 'markdown', 'structured', 'json']).optional(),
    cortexSemanticCache: z.boolean().optional(),
    cortexStructuredContext: z.boolean().optional(),
    cortexPreserveSemantics: z.boolean().optional(),
    cortexIntelligentRouting: z.boolean().optional(),
    
    // Additional optional fields that might be sent from frontend
    conversationHistory: z.array(z.object({
        role: z.enum(['user', 'assistant', 'system']),
        content: z.string(),
        timestamp: z.date().optional()
    })).optional(),
    enableCompression: z.boolean().optional(),
    enableContextTrimming: z.boolean().optional(),
    enableRequestFusion: z.boolean().optional(),
});

// Alert validation schemas
export const createAlertSchema = z.object({
    type: z.enum(['cost_threshold', 'usage_spike', 'optimization_available', 'weekly_summary', 'monthly_summary', 'error_rate']),
    title: z.string().min(1),
    message: z.string().min(1),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    data: z.record(z.any()).optional(),
    actionRequired: z.boolean().optional(),
});

// API Key validation schemas
export const addApiKeySchema = z.object({
    service: z.string().min(1, 'Service is required'),
    key: z.string().min(1, 'API key is required'),
});

// Pagination validation
export const paginationSchema = z.object({
    page: z.string().transform(Number).pipe(z.number().int().positive()).optional(),
    limit: z.string().transform(Number).pipe(z.number().int().positive().max(100)).optional(),
    sort: z.string().optional(),
    order: z.enum(['asc', 'desc']).optional(),
});

// Date range validation
export const dateRangeSchema = z.object({
    startDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
    endDate: z.string().refine((val) => !isNaN(Date.parse(val)), { message: 'Invalid date format' }),
}).refine(data => new Date(data.startDate) <= new Date(data.endDate), {
    message: 'Start date must be before or equal to end date',
});

// Email validation
export const emailSchema = z.object({
    to: z.string().email().or(z.array(z.string().email())),
    subject: z.string().min(1),
    body: z.string().min(1),
    html: z.boolean().optional(),
});

export const updateSubscriptionSchema = z.object({
    plan: z.enum(['free', 'pro', 'enterprise']),
});