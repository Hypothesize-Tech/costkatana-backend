import { Injectable, Logger } from '@nestjs/common';
import { ChatBedrockConverse } from '@langchain/aws';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  PromptTemplate,
  PromptTemplateDocument,
} from '../../../schemas/prompt/prompt-template.schema';
import { User } from '../../../schemas/user/user.schema';
import { Project } from '../../../schemas/team-project/project.schema';
import { Usage } from '../../../schemas/analytics/usage.schema';
import { VectorStoreService } from '../../agent/services/vector-store.service';

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

@Injectable()
export class AITemplateEngineService {
  private readonly logger = new Logger(AITemplateEngineService.name);
  private model: ChatBedrockConverse;

  constructor(
    @InjectModel(PromptTemplate.name)
    private readonly promptTemplateModel: Model<PromptTemplateDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<User>,
    @InjectModel(Project.name)
    private readonly projectModel: Model<Project>,
    @InjectModel(Usage.name)
    private readonly usageModel: Model<Usage>,
    private readonly vectorStoreService: VectorStoreService,
  ) {
    // Use cost-effective model for template operations - Nova Micro is 85% cheaper than Claude
    const templateModel =
      process.env.AWS_BEDROCK_TEMPLATE_MODEL_ID || 'amazon.nova-micro-v1:0';
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

    this.logger.log('🤖 AI Template Engine Service initialized', {
      model: templateModel,
      region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
    });
  }

  /**
   * Generate a template from natural language intent
   */
  async generateTemplateFromIntent(
    request: AITemplateGenerationRequest,
  ): Promise<{
    template: any;
    metadata: {
      generatedBy: string;
      confidence: number;
      alternativeVersions: any[];
    };
  }> {
    try {
      this.logger.log('🎨 Generating template from intent', {
        userId: request.userId,
        intent: request.intent,
        category: request.category,
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
        new HumanMessage(userMessage),
      ]);

      // Extract and parse JSON from the response
      const generatedTemplate = this.extractAndParseJSON(
        response.content as string,
      );

      // Generate alternative versions for A/B testing
      const alternatives = await this.generateAlternativeVersions(
        generatedTemplate,
        2,
      );

      // Calculate confidence score
      const confidence = this.calculateGenerationConfidence(generatedTemplate);

      return {
        template: generatedTemplate,
        metadata: {
          generatedBy: 'ai-template-engine',
          confidence,
          alternativeVersions: alternatives,
        },
      };
    } catch (error) {
      this.logger.error('Error generating template from intent', {
        userId: request.userId,
        intent: request.intent,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Detect variables in template content
   */
  async detectVariables(request: AIVariableDetectionRequest): Promise<{
    variables: Array<{
      name: string;
      description: string;
      defaultValue?: string;
      required: boolean;
      type?: 'text' | 'image';
    }>;
    suggestions: string[];
  }> {
    try {
      this.logger.log('🔍 Detecting variables in content', {
        userId: request.userId,
        contentLength: request.content.length,
      });

      const systemPrompt = `You are an expert at analyzing prompt templates and identifying variables.

Your task is to analyze the provided template content and identify all variables that should be parameterized.

Guidelines:
1. Look for specific values that could vary (names, numbers, descriptions, etc.)
2. Identify both explicit placeholders ({{variable}}) and implicit variables
3. Suggest appropriate variable names and types
4. Provide helpful descriptions for each variable
5. Determine if variables are required or optional

IMPORTANT: Respond with ONLY a valid JSON object with this structure:
{
  "variables": [
    {
      "name": "variableName",
      "description": "What this variable represents",
      "defaultValue": "optional default value",
      "required": true,
      "type": "text"
    }
  ],
  "suggestions": ["Improvement suggestions for the template"]
}`;

      const userMessage = `Analyze this template content and identify variables:\n\n${request.content}`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      const result = this.extractAndParseJSON(response.content as string);

      // Auto-fill defaults if requested
      if (request.autoFillDefaults) {
        result.variables = await this.autoFillVariableDefaults(
          result.variables,
          request.userId,
        );
      }

      return result;
    } catch (error) {
      this.logger.error('Error detecting variables', {
        userId: request.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Optimize an existing template
   */
  async optimizeTemplate(request: AITemplateOptimizationRequest): Promise<{
    optimizedContent: string;
    improvements: string[];
    estimatedSavings: {
      tokens: number;
      cost: number;
      percentage: number;
    };
  }> {
    try {
      this.logger.log('⚡ Optimizing template', {
        templateId: request.templateId,
        userId: request.userId,
        optimizationType: request.optimizationType,
      });

      // Get the template
      const template = await this.promptTemplateModel.findById(
        request.templateId,
      );
      if (!template) {
        throw new Error('Template not found');
      }

      const systemPrompt = `You are an expert prompt optimizer specializing in ${request.optimizationType} optimization.

Your task is to optimize the provided template for ${request.optimizationType} efficiency while preserving the original intent.

Optimization Guidelines:
${request.optimizationType === 'token' ? '- Reduce token count by removing redundant words and simplifying language' : ''}
${request.optimizationType === 'cost' ? '- Optimize for cost efficiency by using more economical phrasing' : ''}
${request.optimizationType === 'quality' ? '- Improve clarity, specificity, and effectiveness' : ''}
${request.optimizationType === 'model-specific' ? `- Optimize for ${request.targetModel} capabilities and patterns` : ''}

${request.preserveIntent ? 'IMPORTANT: Preserve the exact intent and requirements of the original template.' : ''}

Respond with ONLY a valid JSON object:
{
  "optimizedContent": "The optimized template content",
  "improvements": ["List of specific improvements made"],
  "estimatedSavings": {
    "tokens": 50,
    "cost": 0.01,
    "percentage": 15
  }
}`;

      const userMessage = `Optimize this template for ${request.optimizationType}:\n\nOriginal: ${template.content}`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      const result = this.extractAndParseJSON(response.content as string);

      return {
        optimizedContent: result.optimizedContent,
        improvements: result.improvements,
        estimatedSavings: result.estimatedSavings,
      };
    } catch (error) {
      this.logger.error('Error optimizing template', {
        templateId: request.templateId,
        userId: request.userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get template recommendations for a user
   */
  async getTemplateRecommendations(
    userId: string,
    options?: {
      currentProject?: string;
      taskType?: string;
      limit?: number;
    },
  ): Promise<AITemplateRecommendation[]> {
    try {
      this.logger.log('💡 Getting template recommendations', {
        userId,
        currentProject: options?.currentProject,
        taskType: options?.taskType,
      });

      // Get user's usage history
      const usageHistory = await this.usageModel
        .find({
          userId,
          templateUsage: { $exists: true },
        })
        .limit(50)
        .sort({ createdAt: -1 });

      // Get available templates
      const availableTemplates = await this.getAvailableTemplates(userId);

      // Score templates based on relevance
      const recommendations = await Promise.all(
        availableTemplates.map(async (template) => ({
          templateId: template._id.toString(),
          name: template.name,
          relevanceScore: await this.calculateRelevance(template, options),
          reason: this.generateRecommendationReason(template, usageHistory),
          estimatedEffectiveness:
            this.calculateEstimatedEffectiveness(template),
          potentialCostSaving: this.calculatePotentialCostSaving(template),
        })),
      );

      // Sort by relevance and return top results
      return recommendations
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, options?.limit || 5);
    } catch (error) {
      this.logger.error('Error getting template recommendations', {
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Predict template effectiveness
   */
  async predictEffectiveness(
    templateId: string,
    variables?: Record<string, any>,
  ): Promise<TemplateEffectivenessScore> {
    try {
      this.logger.log('🔮 Predicting template effectiveness', { templateId });

      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Get historical usage data
      const usageData = await this.getTemplateUsageData(templateId);

      const systemPrompt = `You are an expert at evaluating prompt template effectiveness.

Analyze the provided template and predict its effectiveness based on:
1. Clarity and specificity
2. Token efficiency
3. Variable usage and appropriateness
4. Expected output quality
5. Historical performance data

Respond with ONLY a valid JSON object:
{
  "overall": 85,
  "clarity": 90,
  "specificity": 80,
  "tokenEfficiency": 75,
  "expectedOutputQuality": 85,
  "suggestions": ["Suggestion 1", "Suggestion 2"]
}`;

      const templateContent = variables
        ? this.fillTemplateVariables(template.content, variables)
        : template.content;

      const userMessage = `Evaluate this template's effectiveness:\n\n${templateContent}\n\nHistorical data: ${JSON.stringify(usageData)}`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      const result = this.extractAndParseJSON(response.content as string);

      return {
        overall: result.overall,
        clarity: result.clarity,
        specificity: result.specificity,
        tokenEfficiency: result.tokenEfficiency,
        expectedOutputQuality: result.expectedOutputQuality,
        suggestions: result.suggestions,
      };
    } catch (error) {
      this.logger.error('Error predicting template effectiveness', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Get insights for a template
   */
  async getTemplateInsights(templateId: string): Promise<TemplateInsight> {
    try {
      this.logger.log('📊 Getting template insights', { templateId });

      const template = await this.promptTemplateModel.findById(templateId);
      if (!template) {
        throw new Error('Template not found');
      }

      // Get usage data
      const usageData = await this.usageModel
        .find({
          'templateUsage.templateId': templateId,
        })
        .limit(100)
        .sort({ createdAt: -1 });

      const insights = this.analyzeUsageData(usageData);

      return {
        usagePatterns: insights.usagePatterns,
        performance: insights.performance,
        recommendations: insights.recommendations,
      };
    } catch (error) {
      this.logger.error('Error getting template insights', {
        templateId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Search templates semantically
   */
  async searchTemplatesSemantic(
    query: string,
    userId: string,
    limit: number = 10,
  ): Promise<
    Array<{
      template: PromptTemplateDocument;
      relevanceScore: number;
      matchedContent: string[];
    }>
  > {
    try {
      this.logger.log('🔍 Performing semantic template search', {
        query,
        userId,
        limit,
      });

      // Get accessible templates
      const templates = await this.promptTemplateModel.find({
        $or: [
          { userId },
          { 'sharing.visibility': { $in: ['public', 'organization'] } },
          { 'sharing.sharedWith': userId },
        ],
      });

      // Use vector search for semantic similarity
      if (templates.length > 0) {
        try {
          // Create searchable content from templates
          const templateContents = templates.map((template) => ({
            id: template._id.toString(),
            content: `${template.name} ${template.description} ${template.content}`,
            metadata: { templateId: template._id.toString() },
          }));

          // Search using vector store
          const searchResults = await this.vectorStoreService.search(
            query,
            Math.min(limit * 2, templates.length),
          );

          // Map search results back to templates
          const results: Array<{
            template: PromptTemplateDocument;
            relevanceScore: number;
            matchedContent: string[];
          }> = [];

          // Create a map for quick template lookup
          const templateMap = new Map(
            templates.map((t) => [t._id.toString(), t]),
          );

          for (const searchResult of searchResults) {
            const template = templateMap.get(searchResult.metadata?.templateId);
            if (template) {
              results.push({
                template,
                relevanceScore: searchResult.score,
                matchedContent: [
                  searchResult.content.substring(0, 200) + '...',
                ],
              });
            }
          }

          // If vector search didn't return enough results, fall back to some templates
          if (results.length < limit && templates.length > results.length) {
            const usedTemplateIds = new Set(
              results.map((r) => r.template._id.toString()),
            );
            const unusedTemplates = templates.filter(
              (t) => !usedTemplateIds.has(t._id.toString()),
            );

            // Add some unused templates with lower scores
            for (const template of unusedTemplates.slice(
              0,
              limit - results.length,
            )) {
              results.push({
                template,
                relevanceScore: 0.1, // Low score for fallback
                matchedContent: [],
              });
            }
          }

          return results
            .filter((result) => result.relevanceScore > 0.05)
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, limit);
        } catch (vectorSearchError) {
          this.logger.warn(
            'Vector search failed, falling back to text matching',
            {
              error:
                vectorSearchError instanceof Error
                  ? vectorSearchError.message
                  : 'Unknown error',
            },
          );

          // Fallback to embedding similarity or text matching
          const results = await Promise.all(
            templates.map(async (template) => {
              const score = await this.calculateTextRelevance(template, query);
              const matchedContent = this.findMatchingContent(template, query);

              return {
                template,
                relevanceScore: score,
                matchedContent,
              };
            }),
          );

          return results
            .filter((result) => result.relevanceScore > 0.1)
            .sort((a, b) => b.relevanceScore - a.relevanceScore)
            .slice(0, limit);
        }
      }

      return [];
    } catch (error) {
      this.logger.error('Error performing semantic search', {
        query,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * Personalize template for user
   */
  async personalizeTemplate(
    templateId: string,
    userId: string,
  ): Promise<{
    personalizedContent: string;
    adaptations: string[];
    reasoning: string;
  }> {
    try {
      this.logger.log('🎯 Personalizing template', { templateId, userId });

      const template = await this.promptTemplateModel.findById(templateId);
      const user = await this.userModel.findById(userId);

      if (!template) {
        throw new Error('Template not found');
      }

      const userProfile = await this.getUserProfile(userId);

      const systemPrompt = `You are an expert at personalizing prompt templates for individual users.

Based on the user's profile and preferences, adapt the template to be more effective for them.

User Profile:
- Experience level: ${userProfile.experienceLevel}
- Preferred style: ${userProfile.preferredStyle}
- Common domains: ${userProfile.commonDomains.join(', ')}
- Preferred models: ${userProfile.preferredModels.join(', ')}

Adapt the template by:
1. Adjusting complexity level
2. Incorporating preferred terminology
3. Adding relevant context from user's domain
4. Optimizing for user's preferred models

Respond with ONLY a valid JSON object:
{
  "personalizedContent": "The adapted template content",
  "adaptations": ["Specific changes made"],
  "reasoning": "Why these adaptations will be more effective"
}`;

      const userMessage = `Personalize this template for the user:\n\nTemplate: ${template.content}`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userMessage),
      ]);

      const result = this.extractAndParseJSON(response.content as string);

      return {
        personalizedContent: result.personalizedContent,
        adaptations: result.adaptations,
        reasoning: result.reasoning,
      };
    } catch (error) {
      this.logger.error('Error personalizing template', {
        templateId,
        userId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  // Private helper methods

  private async getUserContext(userId: string): Promise<{
    preferredStyle: string;
    commonUseCases: string[];
    avgTokenUsage: number;
  }> {
    try {
      // Get user's template usage history
      const usageHistory = await this.usageModel
        .find({
          userId,
          templateUsage: { $exists: true },
        })
        .limit(20)
        .sort({ createdAt: -1 });

      const categories = usageHistory
        .map((u) => u.templateUsage?.templateCategory)
        .filter(Boolean);
      const avgTokens =
        usageHistory.reduce((sum, u) => sum + (u.totalTokens || 0), 0) /
        usageHistory.length;

      return {
        preferredStyle:
          categories.length > 0 ? categories[0] || 'general' : 'general',
        commonUseCases: [...new Set(categories.filter((c) => c !== undefined))],
        avgTokenUsage: Math.round(avgTokens || 100),
      };
    } catch (error) {
      return {
        preferredStyle: 'general',
        commonUseCases: ['general'],
        avgTokenUsage: 100,
      };
    }
  }

  private async getUserProfile(userId: string): Promise<{
    experienceLevel: string;
    preferredStyle: string;
    commonDomains: string[];
    preferredModels: string[];
  }> {
    try {
      const user = await this.userModel.findById(userId);
      const usageHistory = await this.usageModel.find({ userId }).limit(50);

      const models = usageHistory.map((u) => u.model).filter(Boolean);
      const categories = usageHistory
        .map((u) => u.templateUsage?.templateCategory)
        .filter(Boolean);

      return {
        experienceLevel: usageHistory.length > 20 ? 'experienced' : 'beginner',
        preferredStyle: categories[0] || 'general',
        commonDomains: [...new Set(categories.filter((c) => c !== undefined))],
        preferredModels: [...new Set(models.filter((m) => m !== undefined))],
      };
    } catch (error) {
      return {
        experienceLevel: 'beginner',
        preferredStyle: 'general',
        commonDomains: ['general'],
        preferredModels: ['claude-3-haiku'],
      };
    }
  }

  private async getAvailableTemplates(
    userId: string,
  ): Promise<PromptTemplateDocument[]> {
    return await this.promptTemplateModel
      .find({
        $or: [
          { userId },
          { 'sharing.visibility': { $in: ['public', 'organization'] } },
          { 'sharing.sharedWith': userId },
        ],
      })
      .limit(100);
  }

  private async generateAlternativeVersions(
    template: any,
    count: number,
  ): Promise<any[]> {
    try {
      const systemPrompt = `You are an expert prompt engineer. Generate ${count} alternative versions of the given prompt template.
Each alternative should achieve the same goal but use different wording, structure, or approach.
Preserve all {{variable}} placeholders exactly. Return ONLY a JSON array of objects with: name, description, content, variables.
No explanatory text.`;

      const userPrompt = `Original template:
Name: ${template.name}
Description: ${template.description || 'N/A'}
Content: ${template.content}

Generate ${count} distinct alternatives as a JSON array.`;

      const response = await this.model.invoke([
        new SystemMessage(systemPrompt),
        new HumanMessage(userPrompt),
      ]);

      const text = typeof response.content === 'string'
        ? response.content
        : (response.content as any[])?.[0]?.text ?? String(response.content ?? '');
      const raw = text.trim();
      let alternatives: any[];
      if (raw.startsWith('[')) {
        const arrMatch = raw.match(/\[[\s\S]*\]/);
        alternatives = arrMatch ? JSON.parse(arrMatch[0]) : [];
      } else {
        const parsed = this.extractAndParseJSON(raw);
        alternatives = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
      }
      if (Array.isArray(alternatives) && alternatives.length > 0) {
        return alternatives.slice(0, count).map((alt: any, i: number) => ({
          ...template,
          name: alt.name || `${template.name} (Variant ${i + 1})`,
          description: alt.description ?? template.description,
          content: alt.content ?? template.content,
          variables: alt.variables ?? template.variables,
          version: i + 1,
        }));
      }
    } catch (error) {
      this.logger.warn(
        'AI alternative generation failed, using fallback variants',
        { error: error instanceof Error ? error.message : String(error) },
      );
    }
    return Array(count)
      .fill(null)
      .map((_, i) => ({
        ...template,
        name: `${template.name} (Variant ${i + 1})`,
        version: i + 1,
      }));
  }

  private calculateGenerationConfidence(template: any): number {
    // Simple confidence calculation based on completeness
    let confidence = 0.5;

    if (template.name) confidence += 0.1;
    if (template.description) confidence += 0.1;
    if (template.content) confidence += 0.2;
    if (template.variables && template.variables.length > 0) confidence += 0.1;
    if (template.category) confidence += 0.1;

    return Math.min(confidence, 1.0);
  }

  private async autoFillVariableDefaults(
    variables: any[],
    userId: string,
  ): Promise<any[]> {
    // Simplified - would analyze user history to suggest defaults
    return variables.map((variable) => ({
      ...variable,
      defaultValue: variable.defaultValue || 'example value',
    }));
  }

  private async calculateRelevance(
    template: PromptTemplateDocument,
    options?: any,
  ): Promise<number> {
    let score = 0.5;

    if (options?.taskType && template.category === options.taskType)
      score += 0.3;
    if (
      options?.currentProject &&
      template.projectId === options.currentProject
    )
      score += 0.2;

    return Math.min(score, 1.0);
  }

  private generateRecommendationReason(
    template: PromptTemplateDocument,
    usageHistory: any[],
  ): string {
    const reasons = [];

    if (template.category) {
      reasons.push(`Matches your ${template.category} category preferences`);
    }

    if (
      usageHistory.some(
        (u) => u.templateUsage?.templateCategory === template.category,
      )
    ) {
      reasons.push('Based on your usage history');
    }

    return reasons.join('. ') || 'General purpose template';
  }

  private calculateEstimatedEffectiveness(
    template: PromptTemplateDocument,
  ): number {
    // Simple effectiveness calculation
    return template.usage?.averageRating || 0.8;
  }

  private calculatePotentialCostSaving(
    template: PromptTemplateDocument,
  ): number {
    return template.usage?.totalCostSaved || 0;
  }

  private async getTemplateUsageData(templateId: string): Promise<any> {
    const usage = await this.usageModel
      .find({
        'templateUsage.templateId': templateId,
      })
      .limit(10);

    return {
      totalUses: usage.length,
      avgTokens:
        usage.reduce((sum, u) => sum + (u.totalTokens || 0), 0) / usage.length,
      successRate:
        usage.length > 0
          ? usage.filter(
              (u) => !(u as { errorOccurred?: boolean }).errorOccurred,
            ).length / usage.length
          : 0,
    };
  }

  private fillTemplateVariables(
    content: string,
    variables: Record<string, any>,
  ): string {
    let filledContent = content;
    for (const [key, value] of Object.entries(variables)) {
      filledContent = filledContent.replace(
        new RegExp(`{{${key}}}`, 'g'),
        value,
      );
    }
    return filledContent;
  }

  private analyzeUsageData(usageData: any[]): TemplateInsight {
    const totalUses = usageData.length;
    const avgTokens =
      totalUses > 0
        ? usageData.reduce((sum, u) => sum + (u.totalTokens || 0), 0) /
          totalUses
        : 0;

    return {
      usagePatterns: {
        peakTimes: [],
        averageTokensUsed: avgTokens,
        successRate:
          totalUses > 0
            ? usageData.filter((u) => u.status === 'completed').length /
              totalUses
            : 0,
        commonVariations: [],
      },
      performance: {
        averageResponseTime: 0,
        costPerUse: 0,
        userSatisfaction: 0,
        outputQuality: 0,
      },
      recommendations: {
        optimizations: ['Consider adding more specific variables'],
        alternatives: [],
        bestPractices: ['Use clear, descriptive variable names'],
      },
    };
  }

  private async calculateTextRelevance(
    template: PromptTemplateDocument,
    query: string,
  ): Promise<number> {
    try {
      const searchText =
        `${template.name} ${template.description ?? ''} ${template.content}`.trim();
      if (!searchText || !query.trim()) return 0.5;

      const [templateEmb, queryEmb] = await Promise.all([
        this.vectorStoreService.embedText(searchText),
        this.vectorStoreService.embedText(query.trim()),
      ]);
      if (
        !templateEmb?.length ||
        !queryEmb?.length ||
        templateEmb.length !== queryEmb.length
      ) {
        return this.calculateTextRelevanceFallback(template, query);
      }
      const dot = templateEmb.reduce(
        (sum, v, i) => sum + v * (queryEmb[i] ?? 0),
        0,
      );
      const normA = Math.sqrt(
        templateEmb.reduce((s, v) => s + v * v, 0),
      );
      const normB = Math.sqrt(queryEmb.reduce((s, v) => s + v * v, 0));
      const similarity = normA && normB ? dot / (normA * normB) : 0;
      return Math.max(0, Math.min(1, (similarity + 1) / 2)); // cosine to [0,1]
    } catch {
      return this.calculateTextRelevanceFallback(template, query);
    }
  }

  private calculateTextRelevanceFallback(
    template: PromptTemplateDocument,
    query: string,
  ): number {
    const searchText =
      `${template.name} ${template.description ?? ''} ${template.content}`.toLowerCase();
    const queryLower = query.toLowerCase();
    const queryWords = queryLower.split(/\s+/).filter(Boolean);
    if (queryWords.length === 0) return 0.5;
    let matches = 0;
    for (const word of queryWords) {
      if (searchText.includes(word)) matches++;
    }
    return matches / queryWords.length;
  }

  private findMatchingContent(
    template: PromptTemplateDocument,
    query: string,
  ): string[] {
    const matches = [];
    const queryLower = query.toLowerCase();

    if (template.name.toLowerCase().includes(queryLower)) {
      matches.push(`Name: ${template.name}`);
    }
    if (template.description?.toLowerCase().includes(queryLower)) {
      matches.push(`Description: ${template.description}`);
    }

    return matches;
  }

  private extractAndParseJSON(content: string): any {
    try {
      // Try to extract JSON from the response
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON found in response');

      return JSON.parse(jsonMatch[0]);
    } catch (error) {
      this.logger.warn(
        'Failed to parse JSON from AI response, using fallback',
        {
          content: content.substring(0, 200),
          error: error instanceof Error ? error.message : 'Unknown error',
        },
      );

      return this.createFallbackTemplate(content);
    }
  }

  private createFallbackTemplate(content: string): any {
    return {
      name: 'Generated Template',
      description: 'AI-generated template',
      content: content,
      variables: [],
      category: 'general',
      tags: ['ai-generated'],
      estimatedTokens: 100,
      recommendedModel: 'claude-3-haiku',
      tips: ['Review and customize this template'],
    };
  }
}
