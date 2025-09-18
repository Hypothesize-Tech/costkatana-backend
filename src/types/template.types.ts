import mongoose from 'mongoose';

// Template Categories
export type TemplateCategory = 'general' | 'coding' | 'writing' | 'analysis' | 'creative' | 'business' | 'custom';

// Template Visibility
export type TemplateVisibility = 'private' | 'project' | 'organization' | 'public';

// Variable Types
export type VariableType = 'text' | 'number' | 'boolean' | 'date' | 'code' | 'json' | 'url' | 'email' | 'array' | 'object';

// Optimization Types
export type OptimizationType = 'token' | 'cost' | 'quality' | 'model-specific';

// Template Variable Interface
export interface ITemplateVariable {
    name: string;
    type: VariableType;
    description?: string;
    defaultValue?: string;
    required: boolean;
    validationRules?: string[];
}

// Template Metadata Interface
export interface ITemplateMetadata {
    estimatedTokens?: number;
    estimatedCost?: number;
    recommendedModel?: string;
    tags: string[];
    language?: string;
    aiGenerated?: boolean;
    generationConfidence?: number;
    lastOptimized?: Date;
    optimizationType?: OptimizationType;
    effectivenessScore?: number;
    previousVersions?: Array<{
        content: string;
        metadata: Partial<ITemplateMetadata>;
        version: number;
        updatedAt: Date;
    }>;
}

// Template Sharing Interface
export interface ITemplateSharing {
    visibility: TemplateVisibility;
    sharedWith: mongoose.Types.ObjectId[];
    allowFork: boolean;
}

// Template Usage Statistics Interface
export interface ITemplateUsage {
    count: number;
    lastUsed?: Date;
    totalTokensSaved?: number;
    totalCostSaved?: number;
    averageRating?: number;
    feedback: Array<{
        userId: mongoose.Types.ObjectId;
        rating: number;
        comment?: string;
        createdAt: Date;
    }>;
}

// Template Activity Tracking Types
export interface ITemplateActivityMetadata {
    templateId: mongoose.Types.ObjectId;
    templateName: string;
    templateCategory: TemplateCategory;
    templateVersion?: number;
    // AI Generation specific
    intent?: string;
    confidence?: number;
    alternatives?: number;
    // Optimization specific
    optimizationType?: OptimizationType;
    tokenReduction?: number;
    costSaving?: number;
    targetModel?: string;
    // Fork specific
    originalTemplateId?: mongoose.Types.ObjectId;
    forkedTemplateId?: mongoose.Types.ObjectId;
    // Usage specific
    variablesUsed?: Record<string, any>;
    executionTime?: number;
    // Feedback specific
    rating?: number;
    feedback?: string;
    // Variables detection specific
    variablesCount?: number;
    detectedVariables?: string[];
    // Effectiveness prediction specific
    effectivenessScore?: number;
    clarity?: number;
    specificity?: number;
    tokenEfficiency?: number;
    expectedOutputQuality?: number;
}

// Template Creation DTO
export interface CreateTemplateDto {
    name: string;
    description?: string;
    content: string;
    category: TemplateCategory;
    projectId?: string;
    variables?: ITemplateVariable[];
    metadata?: Partial<ITemplateMetadata>;
    sharing?: Partial<ITemplateSharing>;
}

// Template Update DTO
export interface UpdateTemplateDto {
    name?: string;
    description?: string;
    content?: string;
    category?: TemplateCategory;
    variables?: ITemplateVariable[];
    metadata?: Partial<ITemplateMetadata>;
    sharing?: Partial<ITemplateSharing>;
}

// AI Template Generation Request
export interface AITemplateGenerationRequest {
    userId: string;
    intent: string;
    category?: TemplateCategory;
    context?: {
        projectType?: string;
        industry?: string;
        targetAudience?: string;
        tone?: 'formal' | 'casual' | 'technical' | 'creative' | 'professional';
        examples?: string[];
    };
    constraints?: {
        maxTokens?: number;
        targetModel?: string;
        costLimit?: number;
    };
}

// AI Template Optimization Request
export interface AITemplateOptimizationRequest {
    templateId: string;
    userId: string;
    optimizationType: OptimizationType;
    targetModel?: string;
    preserveIntent?: boolean;
}

// AI Variable Detection Request
export interface AIVariableDetectionRequest {
    content: string;
    userId: string;
    autoFillDefaults?: boolean;
    validateTypes?: boolean;
}

// Template Effectiveness Score
export interface TemplateEffectivenessScore {
    overall: number;
    clarity: number;
    specificity: number;
    tokenEfficiency: number;
    expectedOutputQuality: number;
    suggestions: string[];
    strengths?: string[];
    potentialIssues?: string[];
}

// Template Recommendation
export interface TemplateRecommendation {
    templateId: string;
    name: string;
    category: TemplateCategory;
    description?: string;
    relevanceScore: number;
    reason: string;
    estimatedEffectiveness: number;
    potentialCostSaving: number;
}

// Template Insight
export interface TemplateInsight {
    usagePatterns: {
        peakTimes: string[];
        averageTokensUsed: number;
        successRate: number;
        commonVariations: string[];
    };
    performance: {
        averageResponseTime: number;
        costPerUse: number;
        userSatisfaction: number;
        outputQuality: number;
    };
    recommendations: {
        optimizations: string[];
        alternatives: string[];
        bestPractices: string[];
    };
    trends?: {
        usageTrend: 'increasing' | 'stable' | 'decreasing';
        effectivenessTrend: 'improving' | 'stable' | 'declining';
        prediction: string;
    };
}

// Template Query Parameters
export interface TemplateQueryParams {
    userId: string;
    projectId?: string;
    category?: TemplateCategory;
    tags?: string[];
    visibility?: TemplateVisibility;
    search?: string;
    page?: number;
    limit?: number;
    sortBy?: 'name' | 'created' | 'updated' | 'usage' | 'rating';
    sortOrder?: 'asc' | 'desc';
}

// Template Analytics
export interface TemplateAnalytics {
    totalTemplates: number;
    templatesByCategory: Record<TemplateCategory, number>;
    templatesByVisibility: Record<TemplateVisibility, number>;
    mostUsedTemplates: Array<{
        templateId: string;
        name: string;
        usageCount: number;
        category: TemplateCategory;
    }>;
    topRatedTemplates: Array<{
        templateId: string;
        name: string;
        averageRating: number;
        category: TemplateCategory;
    }>;
    aiGeneratedTemplates: number;
    optimizedTemplates: number;
    totalTokensSaved: number;
    totalCostSaved: number;
}

// Template Export Options
export interface TemplateExportOptions {
    templateIds: string[];
    format: 'json' | 'csv' | 'yaml';
    includeMetadata?: boolean;
    includeUsageStats?: boolean;
    includeVariables?: boolean;
}

// Template Import Options
export interface TemplateImportOptions {
    templates: CreateTemplateDto[];
    overwriteExisting?: boolean;
    preserveIds?: boolean;
    updateSharing?: boolean;
}

// Template Activity Types
export type TemplateActivityType = 
    | 'template_created'
    | 'template_updated'
    | 'template_deleted'
    | 'template_forked'
    | 'template_ai_generated'
    | 'template_optimized'
    | 'template_used'
    | 'template_shared'
    | 'template_feedback_added'
    | 'template_variables_detected'
    | 'template_effectiveness_predicted';

// Template Activity Context
export interface TemplateActivityContext {
    type: TemplateActivityType;
    title: string;
    description: string;
    metadata: ITemplateActivityMetadata;
    ipAddress?: string;
    userAgent?: string;
}
