import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { loggingService } from './logging.service';
import { PromptTemplate } from '../models/PromptTemplate';
import { vectorStoreService } from './vectorStore.service';
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { Project } from '../models/Project';
import { User } from '../models/User';
import { Usage } from '../models/Usage';
import { AIInsight } from '../models/AIInsight';


export interface AITemplateGenerationRequest {
    userId: string;
    intent: string;
    category?: string;
    context?: {
        projectType?: string;
        industry?: string;
        targetAudience?: string;
        tone?: 'formal' | 'casual' | 'technical' | 'creative';
        examples?: string[];
    };
    constraints?: {
        maxTokens?: number;
        targetModel?: string;
        costLimit?: number;
    };
}

export interface AITemplateOptimizationRequest {
    templateId: string;
    userId: string;
    optimizationType: 'token' | 'cost' | 'quality' | 'model-specific';
    targetModel?: string;
    preserveIntent?: boolean;
}

export interface AIVariableDetectionRequest {
    content: string;
    userId: string;
    autoFillDefaults?: boolean;
    validateTypes?: boolean;
}

export interface AITemplateRecommendation {
    templateId: string;
    name: string;
    relevanceScore: number;
    reason: string;
    estimatedEffectiveness: number;
    potentialCostSaving: number;
}

export interface TemplateEffectivenessScore {
    overall: number;
    clarity: number;
    specificity: number;
    tokenEfficiency: number;
    expectedOutputQuality: number;
    suggestions: string[];
}

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
}

export class AITemplateEngineService {
    private bedrockClient: BedrockRuntimeClient;
    private model: ChatBedrockConverse;

    constructor() {
        // Initialize AWS Bedrock client
        this.bedrockClient = new BedrockRuntimeClient({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
        });

        // Use cost-effective model for template operations - Nova Micro is 85% cheaper than Claude
        const templateModel = process.env.AWS_BEDROCK_TEMPLATE_MODEL_ID || 'amazon.nova-micro-v1:0';
        this.model = new ChatBedrockConverse({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: templateModel,
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.7,
            maxTokens: 4096,
        });

        loggingService.info('🤖 AI Template Engine Service initialized', { 
            model: templateModel,
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1'
        });
    }

    /**
     * Generate a template from natural language intent
     */
    async generateTemplateFromIntent(request: AITemplateGenerationRequest): Promise<{
        template: any;
        metadata: {
            generatedBy: string;
            confidence: number;
            alternativeVersions: any[];
        };
    }> {
        try {
            loggingService.info('🎨 Generating template from intent', {
                userId: request.userId,
                intent: request.intent,
                category: request.category
            });

            // Analyze user's historical usage for personalization
            const userContext = await this.getUserContext(request.userId);

            // Create the generation prompt
            const systemPrompt = `You are an expert prompt engineer specializing in creating highly effective, optimized templates.
            
Your task is to generate a professional prompt template based on the user's intent.

User Context:
- Preferred style: ${userContext.preferredStyle}
- Common use cases: ${userContext.commonUseCases.join(', ')}
- Average token usage: ${userContext.avgTokenUsage}

Requirements:
1. Create a clear, effective template that achieves the stated intent
2. Include relevant variables marked with {{variableName}}
3. Optimize for token efficiency while maintaining quality
4. Consider the target audience and use case
5. Make it reusable and adaptable

Context provided:
- Category: ${request.category || 'general'}
- Project Type: ${request.context?.projectType || 'not specified'}
- Industry: ${request.context?.industry || 'not specified'}
- Target Audience: ${request.context?.targetAudience || 'general'}
- Tone: ${request.context?.tone || 'professional'}
${request.context?.examples ? `Examples to consider:\n${request.context.examples.join('\n')}` : ''}

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON. 
- Use \\n for newlines within string values
- Escape all special characters properly
- Do not use literal newlines or tabs in JSON strings
- Ensure all strings are properly quoted and escaped

The JSON should have this exact structure:

{
  "name": "Template name",
  "description": "Brief description",
  "content": "The actual template content with {{variables}}",
  "variables": [
    {"name": "variableName", "description": "What this variable is for", "defaultValue": "optional default", "required": true}
  ],
  "category": "most appropriate category",
  "tags": ["relevant", "tags"],
  "estimatedTokens": 100,
  "recommendedModel": "claude-3-5-sonnet",
  "tips": ["usage tips"]
}`;

            const userMessage = `Create a prompt template for: "${request.intent}"`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(userMessage)
            ]);

            // Extract and parse JSON from the response
            const generatedTemplate = this.extractAndParseJSON(response.content as string);

            // Generate alternative versions for A/B testing
            const alternatives = await this.generateAlternativeVersions(
                generatedTemplate,
                2
            );

            // Calculate confidence score
            const confidence = await this.calculateGenerationConfidence(
                generatedTemplate
            );

            // Store generation metadata for learning
            await this.storeGenerationMetadata(request.userId, request.intent, generatedTemplate);

            return {
                template: {
                    ...generatedTemplate,
                    metadata: {
                        ...generatedTemplate.metadata,
                        aiGenerated: true,
                        generationContext: request.context,
                        generatedAt: new Date()
                    }
                },
                metadata: {
                    generatedBy: 'Claude 3.5 Sonnet',
                    confidence,
                    alternativeVersions: alternatives
                }
            };

        } catch (error) {
            loggingService.error('❌ Failed to generate template from intent', error as Error);
            throw error;
        }
    }

    /**
     * Detect and extract variables from template content
     */
    async detectVariables(request: AIVariableDetectionRequest): Promise<{
        variables: Array<{
            name: string;
            description: string;
            type: string;
            defaultValue?: string;
            required: boolean;
            validationRules?: string[];
        }>;
        suggestions: string[];
    }> {
        try {
            loggingService.info('🔍 Detecting variables in content');

            const systemPrompt = `You are an expert at analyzing text templates and identifying variables.

Analyze the provided content and:
1. Identify all existing variables (marked with {{variableName}} or similar patterns)
2. Suggest additional variables that would make the template more flexible
3. Determine the type of each variable (text, number, boolean, date, code, etc.)
4. Suggest appropriate default values
5. Identify which variables are required vs optional

Return a JSON object with:
{
  "variables": [
    {
      "name": "variableName",
      "description": "Clear description of what this variable represents",
      "type": "text|number|boolean|date|code|json|url|email",
      "defaultValue": "suggested default if applicable",
      "required": true/false,
      "validationRules": ["any validation rules"]
    }
  ],
  "suggestions": ["Additional variables you recommend adding"],
  "improvements": ["Ways to better structure the variables"]
}`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(`Analyze this template content:\n\n${request.content}`)
            ]);

            const result = this.extractAndParseJSON(response.content as string);

            // Auto-fill defaults from user's data if requested
            if (request.autoFillDefaults && request.userId) {
                result.variables = await this.autoFillVariableDefaults(
                    result.variables,
                    request.userId
                );
            }

            return result;

        } catch (error) {
            loggingService.error('❌ Failed to detect variables', error as Error);
            throw error;
        }
    }

    /**
     * Optimize an existing template
     */
    async optimizeTemplate(request: AITemplateOptimizationRequest): Promise<{
        original: any;
        optimized: any;
        metrics: {
            tokenReduction: number;
            costSaving: number;
            qualityScore: number;
            recommendations: string[];
        };
    }> {
        try {
            loggingService.info('⚡ Optimizing template', {
                templateId: request.templateId,
                type: request.optimizationType
            });

            const template = await PromptTemplate.findById(request.templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            let optimizationPrompt = '';
            switch (request.optimizationType) {
                case 'token':
                    optimizationPrompt = `Optimize this template to use fewer tokens while maintaining the same intent and effectiveness. Focus on conciseness without losing clarity.`;
                    break;
                case 'cost':
                    optimizationPrompt = `Optimize this template for cost efficiency. Suggest ways to achieve the same results with lower token usage and recommend cost-effective models.`;
                    break;
                case 'quality':
                    optimizationPrompt = `Optimize this template for output quality. Make it more specific, clear, and likely to produce high-quality responses.`;
                    break;
                case 'model-specific':
                    optimizationPrompt = `Optimize this template specifically for ${request.targetModel || 'Claude 3.5'}. Adjust the structure and phrasing to work best with this model's strengths.`;
                    break;
            }

            const systemPrompt = `You are an expert prompt engineer specializing in optimization.

${optimizationPrompt}

Original template effectiveness should be preserved or improved.

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.
- Use \\n for newlines within string values
- Escape all special characters properly
- Do not use literal newlines or tabs in JSON strings
- Ensure all strings are properly quoted and escaped

Return a JSON object with:
{
  "content": "The optimized template content",
  "changes": ["List of specific changes made"],
  "estimatedTokens": number,
  "estimatedTokenReduction": percentage,
  "qualityImpact": "positive|neutral|slight negative",
  "recommendations": ["Additional optimization suggestions"]
}`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(`Template to optimize:\n\n${template.content}`)
            ]);

            const optimizationResult = this.extractAndParseJSON(response.content as string);

            // Calculate actual metrics
            const originalTokens = await this.estimateTokens(template.content);
            const optimizedTokens = await this.estimateTokens(optimizationResult.content);
            const tokenReduction = ((originalTokens - optimizedTokens) / originalTokens) * 100;

            // Estimate cost saving based on average model pricing
            const costSaving = this.calculateCostSaving(originalTokens, optimizedTokens);

            // Update template with optimized version if user approves
            const optimizedTemplate = {
                ...template.toObject(),
                content: optimizationResult.content,
                metadata: {
                    ...template.metadata,
                    estimatedTokens: optimizedTokens,
                    lastOptimized: new Date(),
                    optimizationType: request.optimizationType
                }
            };

            return {
                original: template.toObject(),
                optimized: optimizedTemplate,
                metrics: {
                    tokenReduction: Math.round(tokenReduction),
                    costSaving,
                    qualityScore: this.calculateQualityScore(optimizationResult),
                    recommendations: optimizationResult.recommendations
                }
            };

        } catch (error) {
            loggingService.error('❌ Failed to optimize template', error as Error);
            throw error;
        }
    }

    /**
     * Get AI-powered template recommendations
     */
    async getTemplateRecommendations(
        userId: string,
        context: {
            currentProject?: string;
            recentActivity?: string[];
            taskType?: string;
        }
    ): Promise<AITemplateRecommendation[]> {
        try {
            loggingService.info('🎯 Getting template recommendations', { userId });

            // Get user's usage history and preferences
            const userProfile = await this.getUserProfile(userId);
            const availableTemplates = await this.getAvailableTemplates(userId);

            // Use AI to match templates with user's context
            const systemPrompt = `You are an AI assistant specializing in template recommendations.

Based on the user's profile and context, recommend the most relevant templates.

User Profile:
- Common tasks: ${userProfile.commonTasks.join(', ')}
- Preferred categories: ${userProfile.preferredCategories.join(', ')}
- Average usage: ${userProfile.usageFrequency}
- Recent activity: ${context.recentActivity?.join(', ') || 'none'}

Current Context:
- Project: ${context.currentProject || 'general'}
- Task type: ${context.taskType || 'unspecified'}

Available templates:
${availableTemplates.map(t => `- ${t.name}: ${t.description} (${t.category})`).join('\n')}

Return a JSON array of recommended templates (max 5):
[
  {
    "templateId": "id from available templates",
    "relevanceScore": 0-100,
    "reason": "Why this template is recommended",
    "estimatedEffectiveness": 0-100,
    "potentialCostSaving": 0-100
  }
]`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage('Recommend the best templates for this user')
            ]);

            const recommendations = this.extractAndParseJSON(response.content as string);

            // Enhance recommendations with actual template data
            const enhancedRecommendations = await Promise.all(
                recommendations.map(async (rec: any) => {
                    const template = availableTemplates.find(t => t._id.toString() === rec.templateId);
                    return {
                        ...rec,
                        templateId: rec.templateId,
                        name: template?.name || 'Unknown',
                        category: template?.category,
                        description: template?.description
                    };
                })
            );

            return enhancedRecommendations;

        } catch (error) {
            loggingService.error('❌ Failed to get recommendations', error as Error);
            throw error;
        }
    }

    /**
     * Predict template effectiveness before use
     */
    async predictEffectiveness(
        templateId: string,
        variables?: Record<string, any>
    ): Promise<TemplateEffectivenessScore> {
        try {
            loggingService.info('📊 Predicting template effectiveness', { templateId });

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Process template with variables if provided
            let processedContent = template.content;
            if (variables) {
                Object.entries(variables).forEach(([key, value]) => {
                    processedContent = processedContent.replace(
                        new RegExp(`{{${key}}}`, 'g'),
                        value
                    );
                });
            }

            const systemPrompt = `You are an expert at analyzing prompt effectiveness.

Analyze this template and predict its effectiveness across multiple dimensions.

Consider:
1. Clarity: How clear and unambiguous is the instruction?
2. Specificity: How specific and detailed is the prompt?
3. Token Efficiency: How well does it use tokens?
4. Expected Output Quality: How likely is it to produce high-quality responses?

Return a JSON object with scores (0-100) and specific suggestions:
{
  "overall": overall effectiveness score,
  "clarity": clarity score,
  "specificity": specificity score,
  "tokenEfficiency": efficiency score,
  "expectedOutputQuality": quality score,
  "suggestions": ["Specific improvements"],
  "strengths": ["What works well"],
  "potentialIssues": ["Potential problems"]
}`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(`Template to analyze:\n\n${processedContent}`)
            ]);

            const effectiveness = this.extractAndParseJSON(response.content as string);

            // Store prediction for learning
            await this.storePrediction(templateId, effectiveness);

            return effectiveness;

        } catch (error) {
            loggingService.error('❌ Failed to predict effectiveness', error as Error);
            throw error;
        }
    }

    /**
     * Get AI-powered insights for a template
     */
    async getTemplateInsights(templateId: string): Promise<TemplateInsight> {
        try {
            loggingService.info('📈 Getting template insights', { templateId });

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }

            // Gather usage data
            const usageData = await this.getTemplateUsageData(templateId);

            // Analyze patterns with AI
            const systemPrompt = `You are an analytics expert analyzing template performance.

Based on this usage data, provide actionable insights:

Template: ${template.name}
Category: ${template.category}
Usage Count: ${template.usage.count}
Average Rating: ${template.usage.averageRating || 'N/A'}
Total Tokens Saved: ${template.usage.totalTokensSaved || 0}
Total Cost Saved: $${template.usage.totalCostSaved || 0}

Historical Usage Data:
${JSON.stringify(usageData, null, 2)}

IMPORTANT: You must respond with ONLY a valid JSON object. Do not include any explanatory text before or after the JSON.
- Use \\n for newlines within string values
- Escape all special characters properly
- Do not use literal newlines or tabs in JSON strings
- Ensure all strings are properly quoted and escaped

Provide insights in JSON format:
{
  "usagePatterns": {
    "peakTimes": ["time periods when most used"],
    "averageTokensUsed": number,
    "successRate": percentage,
    "commonVariations": ["how users typically modify it"]
  },
  "performance": {
    "averageResponseTime": seconds,
    "costPerUse": dollars,
    "userSatisfaction": 0-100,
    "outputQuality": 0-100
  },
  "recommendations": {
    "optimizations": ["Specific ways to improve"],
    "alternatives": ["Alternative approaches"],
    "bestPractices": ["Best practices for this template"]
  },
  "trends": {
    "usageTrend": "increasing|stable|decreasing",
    "effectivenessTrend": "improving|stable|declining",
    "prediction": "Future usage prediction"
  }
}`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage('Analyze and provide insights')
            ]);

            const insights = this.extractAndParseJSON(response.content as string);

            // Store insights for dashboard
            await this.storeInsights(templateId, insights);

            return insights;

        } catch (error) {
            loggingService.error('❌ Failed to get insights', error as Error);
            throw error;
        }
    }

    /**
     * Semantic search for templates
     */
    async searchTemplatesSemantic(
        query: string,
        userId: string,
        limit: number = 10
    ): Promise<any[]> {
        try {
            loggingService.info('🔍 Semantic template search', { query });

            // Use vector store for semantic search
            const results = await vectorStoreService.search(query, limit);

            // Filter templates user has access to
            const accessibleTemplates = await this.filterAccessibleTemplates(
                results.map(r => r.id).filter(id => id !== undefined) as string[],
                userId
            );

            // Enhance results with AI-powered relevance scoring
            const enhancedResults = await this.enhanceSearchResults(
                accessibleTemplates,
                query
            );

            return enhancedResults;

        } catch (error) {
            loggingService.error('❌ Failed semantic search', error as Error);
            throw error;
        }
    }

    /**
     * Auto-adapt template based on user preferences
     */
    async personalizeTemplate(
        templateId: string,
        userId: string
    ): Promise<any> {
        try {
            loggingService.info('👤 Personalizing template', { templateId, userId });

            const template = await PromptTemplate.findById(templateId);
            if (!template) {
                throw new Error('Template not found');
            }
            
            const userProfile = await this.getUserProfile(userId);

            const systemPrompt = `You are personalizing a template based on user preferences.

User Preferences:
- Writing style: ${userProfile.writingStyle}
- Tone preference: ${userProfile.tonePreference}
- Detail level: ${userProfile.detailLevel}
- Industry: ${userProfile.industry}

Adapt this template to match the user's style while maintaining its effectiveness.

Return the personalized template content.`;

            const response = await this.model.invoke([
                new SystemMessage(systemPrompt),
                new HumanMessage(`Template to personalize:\n\n${template.content}`)
            ]);

            return {
                ...template.toObject(),
                content: response.content,
                metadata: {
                    ...template.metadata,
                    personalized: true,
                    personalizedFor: userId
                }
            };

        } catch (error) {
            loggingService.error('❌ Failed to personalize template', error as Error);
            throw error;
        }
    }

    // Helper methods
    private async getUserContext(userId: string): Promise<any> {
        const recentUsage = await Usage.find({ userId }).sort({ createdAt: -1 }).limit(10);
        
        return {
            preferredStyle: 'balanced',
            commonUseCases: this.extractCommonUseCases(recentUsage),
            avgTokenUsage: this.calculateAverageTokenUsage(recentUsage)
        };
    }

    private async getUserProfile(userId: string): Promise<any> {
        const usage = await Usage.find({ userId }).sort({ createdAt: -1 }).limit(50);
        const templates = await PromptTemplate.find({ createdBy: userId });

        return {
            commonTasks: this.extractCommonTasks(usage),
            preferredCategories: this.extractPreferredCategories(templates),
            usageFrequency: usage.length,
            writingStyle: 'professional',
            tonePreference: 'neutral',
            detailLevel: 'moderate',
            industry: 'general'
        };
    }

    private async getAvailableTemplates(userId: string): Promise<any[]> {
        // Get templates user has access to
        const userProjects = await Project.find({
            $or: [
                { ownerId: userId },
                { 'members.userId': userId }
            ]
        });

        const projectIds = userProjects.map(p => p._id);

        return await PromptTemplate.find({
            $or: [
                { createdBy: userId },
                { 'sharing.visibility': 'public' },
                { projectId: { $in: projectIds } },
                { 'sharing.sharedWith': userId }
            ],
            isActive: true
        }).limit(50);
    }

    private async generateAlternativeVersions(
        template: any,
        count: number
    ): Promise<any[]> {
        const alternatives = [];
        for (let i = 0; i < count; i++) {
            const variation = await this.generateVariation(template, i + 1);
            alternatives.push(variation);
        }
        return alternatives;
    }

    private async generateVariation(template: any, version: number): Promise<any> {
        const variations = ['concise', 'detailed', 'creative'];
        const style = variations[version - 1] || 'balanced';

        const response = await this.model.invoke([
            new SystemMessage(`Create a ${style} variation of this template`),
            new HumanMessage(JSON.stringify(template))
        ]);

        return this.extractAndParseJSON(response.content as string);
    }

    private async calculateGenerationConfidence(template: any): Promise<number> {
        // Simple confidence calculation based on template completeness
        let confidence = 60; // Base confidence

        if (template.content && template.content.length > 50) confidence += 10;
        if (template.variables && template.variables.length > 0) confidence += 10;
        if (template.description) confidence += 5;
        if (template.tags && template.tags.length > 0) confidence += 5;
        if (template.estimatedTokens) confidence += 5;
        if (template.recommendedModel) confidence += 5;

        return Math.min(confidence, 95);
    }

    private async estimateTokens(content: string): Promise<number> {
        // Simple token estimation (actual implementation would use proper tokenizer)
        return Math.ceil(content.length / 4);
    }

    private calculateCostSaving(originalTokens: number, optimizedTokens: number): number {
        const avgCostPerToken = 0.00002; // Average across models
        return (originalTokens - optimizedTokens) * avgCostPerToken;
    }

    private calculateQualityScore(result: any): number {
        // Calculate quality score based on optimization result
        let score = 70; // Base score
        
        if (result.qualityImpact === 'positive') score += 20;
        else if (result.qualityImpact === 'neutral') score += 10;
        
        if (result.estimatedTokenReduction > 30) score += 10;
        
        return Math.min(score, 100);
    }

    private async autoFillVariableDefaults(variables: any[], userId: string): Promise<any[]> {
        const user = await User.findById(userId);
        const project = await Project.findOne({ ownerId: userId });

        return variables.map(variable => {
            // Auto-fill common variables
            if (variable.name === 'userName' || variable.name === 'name') {
                variable.defaultValue = user?.name || '';
            } else if (variable.name === 'projectName' || variable.name === 'project') {
                variable.defaultValue = project?.name || '';
            } else if (variable.name === 'date' || variable.name === 'currentDate') {
                variable.defaultValue = new Date().toISOString().split('T')[0];
            } else if (variable.name === 'language') {
                variable.defaultValue = 'English';
            }
            
            return variable;
        });
    }

    private async getTemplateUsageData(templateId: string): Promise<any> {
        const usages = await Usage.find({ 
            'metadata.templateId': templateId 
        }).sort({ createdAt: -1 }).limit(100);

        return {
            totalUses: usages.length,
            uniqueUsers: [...new Set(usages.map(u => u.userId?.toString()))].length,
            avgTokens: usages.reduce((acc, u) => acc + (u.totalTokens || 0), 0) / usages.length,
            timeDistribution: this.analyzeTimeDistribution(usages)
        };
    }

    private async filterAccessibleTemplates(templateIds: string[], userId: string): Promise<any[]> {
        return await PromptTemplate.find({
            _id: { $in: templateIds },
            $or: [
                { createdBy: userId },
                { 'sharing.visibility': 'public' },
                { 'sharing.sharedWith': userId }
            ]
        });
    }

    private async enhanceSearchResults(templates: any[], query: string): Promise<any[]> {
        return Promise.all(templates.map(async template => {
            const relevance = await this.calculateRelevance(template, query);
            return {
                ...template.toObject(),
                searchRelevance: relevance,
                highlightedContent: this.highlightMatches(template.content, query)
            };
        }));
    }

    private async calculateRelevance(template: any, query: string): Promise<number> {
        // Calculate relevance score using multiple factors
        let score = 0;
        
        const queryLower = query.toLowerCase();
        const contentLower = template.content.toLowerCase();
        const nameLower = template.name.toLowerCase();
        
        // Direct matches
        if (nameLower.includes(queryLower)) score += 30;
        if (contentLower.includes(queryLower)) score += 20;
        
        // Category match
        if (template.category && queryLower.includes(template.category)) score += 15;
        
        // Tag matches
        if (template.metadata?.tags) {
            template.metadata.tags.forEach((tag: string) => {
                if (queryLower.includes(tag.toLowerCase())) score += 10;
            });
        }
        
        // Usage popularity
        score += Math.min(template.usage?.count || 0, 20);
        
        return Math.min(score, 100);
    }

    private highlightMatches(content: string, query: string): string {
        const regex = new RegExp(`(${query})`, 'gi');
        return content.replace(regex, '**$1**');
    }

    private extractCommonUseCases(usage: any[]): string[] {
        // Extract common use cases from usage patterns
        const cases = new Map<string, number>();
        
        usage.forEach(u => {
            const useCase = u.metadata?.useCase || 'general';
            cases.set(useCase, (cases.get(useCase) || 0) + 1);
        });
        
        return Array.from(cases.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([useCase]) => useCase);
    }

    private extractCommonTasks(usage: any[]): string[] {
        const tasks = new Map<string, number>();
        
        usage.forEach(u => {
            const task = u.metadata?.task || u.operation || 'general';
            tasks.set(task, (tasks.get(task) || 0) + 1);
        });
        
        return Array.from(tasks.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([task]) => task);
    }

    private extractPreferredCategories(templates: any[]): string[] {
        const categories = new Map<string, number>();
        
        templates.forEach(t => {
            categories.set(t.category, (categories.get(t.category) || 0) + 1);
        });
        
        return Array.from(categories.entries())
            .sort((a, b) => b[1] - a[1])
            .map(([category]) => category);
    }

    private calculateAverageTokenUsage(usage: any[]): number {
        if (usage.length === 0) return 0;
        
        const total = usage.reduce((acc, u) => acc + (u.totalTokens || 0), 0);
        return Math.round(total / usage.length);
    }

    private analyzeTimeDistribution(usages: any[]): any {
        const hourlyDistribution = new Array(24).fill(0);
        
        usages.forEach(u => {
            const hour = new Date(u.createdAt).getHours();
            hourlyDistribution[hour]++;
        });
        
        return {
            hourly: hourlyDistribution,
            peakHour: hourlyDistribution.indexOf(Math.max(...hourlyDistribution)),
            mostActiveHours: hourlyDistribution
                .map((count, hour) => ({ hour, count }))
                .sort((a, b) => b.count - a.count)
                .slice(0, 3)
                .map(h => h.hour)
        };
    }

    private async storeGenerationMetadata(userId: string, intent: string, template: any): Promise<void> {
        try {
            await AIInsight.create({
                type: 'template_generation',
                userId,
                metadata: {
                    intent,
                    templateId: template._id,
                    category: template.category,
                    tokenCount: template.estimatedTokens
                },
                timestamp: new Date()
            });
        } catch (error) {
            loggingService.warn('Failed to store generation metadata', error as Error);
        }
    }

    private async storePrediction(templateId: string, prediction: any): Promise<void> {
        try {
            await AIInsight.create({
                type: 'effectiveness_prediction',
                metadata: {
                    templateId,
                    prediction,
                    timestamp: new Date()
                }
            });
        } catch (error) {
            loggingService.warn('Failed to store prediction', error as Error);
        }
    }

    private async storeInsights(templateId: string, insights: any): Promise<void> {
        try {
            await AIInsight.create({
                type: 'template_insights',
                metadata: {
                    templateId,
                    insights,
                    generatedAt: new Date()
                }
            });
        } catch (error) {
            loggingService.warn('Failed to store insights', error as Error);
        }
    }

    /**
     * Extract and parse JSON from AI response that might contain additional text
     */
    private extractAndParseJSON(content: string): any {
        try {
            // First, try to parse the content directly as JSON
            return JSON.parse(content);
        } catch (error) {
            // If direct parsing fails, try to clean and extract JSON from the content
            try {
                // Look for JSON object patterns in the content
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) {
                    let jsonString = jsonMatch[0];
                    
                    // Clean up common JSON formatting issues
                    jsonString = this.cleanJsonString(jsonString);
                    
                    return JSON.parse(jsonString);
                }

                // Look for JSON array patterns
                const arrayMatch = content.match(/\[[\s\S]*\]/);
                if (arrayMatch) {
                    let jsonString = arrayMatch[0];
                    jsonString = this.cleanJsonString(jsonString);
                    return JSON.parse(jsonString);
                }

                // If no JSON found, create a fallback response
                loggingService.warn('No JSON found in AI response, creating fallback', { content });
                return this.createFallbackTemplate(content);
            } catch (parseError) {
                loggingService.error('Failed to extract JSON from AI response', { content, error: parseError });
                return this.createFallbackTemplate(content);
            }
        }
    }

    /**
     * Clean JSON string to fix common formatting issues from AI responses
     */
    private cleanJsonString(jsonString: string): string {
        try {
            // Remove any leading/trailing whitespace
            jsonString = jsonString.trim();
            
            // Simple but effective approach: fix the most common issues
            
            // 1. First, escape literal newlines, tabs, etc.
            jsonString = jsonString
                .replace(/\n/g, '\\n')
                .replace(/\r/g, '\\r')
                .replace(/\t/g, '\\t')
                .replace(/\f/g, '\\f')
                .replace(/\x08/g, '\\b');
            
            // 2. Fix unescaped quotes within string values (common in AI responses)
            // This regex finds patterns like: "text with "quotes" inside"
            // and replaces them with: "text with \"quotes\" inside"
            jsonString = jsonString.replace(
                /"([^"]*)"([^"]*)"([^"]*)"(\s*[,\]}])/g,
                '"$1\\"$2\\"$3"$4'
            );
            
            // Handle cases with multiple quotes in one string
            jsonString = jsonString.replace(
                /"([^"]*)"([^"]*)"([^"]*)"([^"]*)"([^"]*)"(\s*[,\]}])/g,
                '"$1\\"$2\\"$3\\"$4\\"$5"$6'
            );
            
            // 3. Fix trailing commas
            jsonString = jsonString.replace(/,(\s*[}\]])/g, '$1');
            
            return jsonString;
        } catch (error) {
            // If cleaning fails, return original
            loggingService.warn('Failed to clean JSON string', { error });
            return jsonString;
        }
    }

    /**
     * Create a fallback template when JSON parsing fails
     */
    private createFallbackTemplate(content: string): any {
        return {
            name: "AI Generated Template",
            description: "Template generated from AI response",
            content: content.trim(),
            variables: [],
            category: "general",
            tags: ["ai-generated"],
            estimatedTokens: Math.ceil(content.length / 4), // Rough token estimate
            recommendedModel: "claude-3-5-sonnet",
            tips: ["Review and customize this template as needed"]
        };
    }
}

// Export singleton instance
export const aiTemplateEngine = new AITemplateEngineService();
