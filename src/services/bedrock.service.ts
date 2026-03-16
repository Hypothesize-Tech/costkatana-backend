import { Injectable, Logger } from '@nestjs/common';
import {
  InvokeModelCommand,
  ConverseStreamCommand,
  Message,
} from '@aws-sdk/client-bedrock-runtime';
import { ListInferenceProfilesCommand } from '@aws-sdk/client-bedrock';
import { bedrockClient, bedrockControlClient, AWS_CONFIG } from '../config/aws';
import { ServiceHelper } from '../utils/serviceHelper';
import {
  GenAITelemetryService,
  recordGenAIUsage,
} from '../utils/genaiTelemetry';
import { calculateCost } from '../modules/visual-compliance/utils/pricing';
import { estimateTokens } from '../utils/tokenCounter';
import { AIProvider } from '../types/aiCostTracker.types';
import { decodeFromTOON } from '../utils/toon.utils';
import {
  RawPricingData,
  LLMExtractionResult,
} from '../types/modelDiscovery.types';
import { getMaxTokensForModel } from '../utils/model-tokens';

interface PromptOptimizationRequest {
  prompt: string;
  model: string;
  service: string;
  context?: string;
  targetReduction?: number;
  preserveIntent?: boolean;
}

interface PromptOptimizationResponse {
  optimizedPrompt: string;
  techniques: string[];
  estimatedTokenReduction: number;
  suggestions: string[];
  alternatives?: string[];
}

interface UsageAnalysisRequest {
  usageData: Array<{
    prompt: string;
    tokens: number;
    cost: number;
    timestamp: Date;
  }>;
  timeframe: 'daily' | 'weekly' | 'monthly';
}

interface UsageAnalysisResponse {
  patterns: string[];
  recommendations: string[];
  potentialSavings: number;
  optimizationOpportunities: Array<{
    prompt: string;
    reason: string;
    estimatedSaving: number;
  }>;
}

@Injectable()
export class BedrockService {
  private readonly logger = new Logger(BedrockService.name);
  private static staticLogger = new Logger(BedrockService.name);

  constructor(private readonly telemetryService: GenAITelemetryService) {}

  /**
   * Extract JSON from text response
   */
  static async extractJson(text: string): Promise<string> {
    ServiceHelper.logMethodEntry('BedrockService.extractJson', {
      textLength: text?.length,
    });

    // Edge case: null/undefined/empty input
    if (!text || typeof text !== 'string' || text.trim().length === 0) {
      return '';
    }

    // Edge case: very large text (potential DoS)
    const MAX_EXTRACT_SIZE = 5 * 1024 * 1024; // 5MB limit
    if (text.length > MAX_EXTRACT_SIZE) {
      BedrockService.staticLogger.warn(
        'Text too large for extraction, truncating',
        {
          size: text.length,
          maxSize: MAX_EXTRACT_SIZE,
        },
      );
      text = text.substring(0, MAX_EXTRACT_SIZE);
    }

    // First, try to extract TOON format (for Cortex responses)
    // Enhanced pattern matching for malformed TOON
    const toonPatterns = [
      /(\w+\[\d+\]\{[^}]+\}:[\s\S]*?)(?=\n\n|\n\w+\[|$)/,
      /(\w+\s*\[\s*\d+\s*\]\s*\{[^}]+\}\s*:[\s\S]*?)(?=\n\n|\n\w+\s*\[|$)/,
    ];

    for (const pattern of toonPatterns) {
      const toonMatch = text.match(pattern);
      if (toonMatch) {
        const toonText = toonMatch[1].trim();
        try {
          const decoded = decodeFromTOON(JSON.parse(toonText));
          return JSON.stringify(decoded.original);
        } catch (toonError) {
          BedrockService.staticLogger.warn('Failed to decode TOON format', {
            toonError,
            toonText,
          });
        }
      }
    }

    const tryParseWithRecovery = (candidate: string): string | null => {
      try {
        JSON.parse(candidate);
        return candidate;
      } catch (parseError: unknown) {
        const msg = String((parseError as Error)?.message ?? '');
        const posMatch = msg.match(/position\s+(\d+)/i);
        if (posMatch) {
          const pos = parseInt(posMatch[1], 10);
          const truncated = candidate.substring(0, pos).trim();
          try {
            JSON.parse(truncated);
            return truncated;
          } catch {
            // ignore
          }
        }
        return null;
      }
    };

    // First try: extract from markdown code block (```json ... ``` or ``` ... ```)
    // Non-greedy regex fails on nested JSON; extract full block content then parse
    const codeBlockMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      const blockContent = codeBlockMatch[1].trim();
      const blockResult = tryParseWithRecovery(blockContent);
      if (blockResult) return blockResult;
      const innerMatch = blockContent.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
      if (innerMatch) {
        const candidate = innerMatch[1];
        const innerResult = tryParseWithRecovery(candidate);
        if (innerResult) return innerResult;
      }
    }

    // Fallback to standard JSON extraction
    const jsonPatterns = [
      // Standard JSON object/array (greedy - match full extent)
      /(\{[\s\S]*\}|\[[\s\S]*\])/,

      // JSON after colon (common in API responses)
      /:\s*(\{[\s\S]*\}|\[[\s\S]*\])/,

      // JSON in quotes
      /"(\{[\s\S]*\})"|'(\{[\s\S]*\})'/,

      // Last resort: find anything that looks like JSON
      /(\{[^{}]*\{[^{}]*\}[^{}]*\}|\[[^\[\]]*\[[^\[\]]*\][^\[\]]*\])/,
    ];

    for (const pattern of jsonPatterns) {
      const match = text.match(pattern);
      if (match) {
        const jsonCandidate = match[1] || match[0];
        const result = tryParseWithRecovery(jsonCandidate);
        if (result) return result;
        BedrockService.staticLogger.debug('JSON candidate failed to parse', {
          candidate: match[0]?.substring(0, 200),
        });
        continue;
      }
    }

    // If no valid JSON found, return empty string
    BedrockService.staticLogger.warn('No valid JSON found in text', {
      textPreview: text.substring(0, 200),
    });
    ServiceHelper.logMethodExit('BedrockService.extractJson', 'empty');
    return '';
  }

  /**
   * Get appropriate max tokens based on model capability
   */
  private static getMaxTokensForModel(modelId: string): number {
    return getMaxTokensForModel(modelId, AWS_CONFIG.bedrock.maxTokens);
  }

  /**
   * Find an ACTIVE inference profile ARN that contains the given foundation model ID.
   * Used when a model is only available via inference profiles (not on-demand).
   */
  static async findInferenceProfileArnForModel(
    foundationModelId: string,
  ): Promise<string | null> {
    try {
      let nextToken: string | undefined;
      const normalizedId = foundationModelId.trim().toLowerCase();
      do {
        const response = await bedrockControlClient.send(
          new ListInferenceProfilesCommand({
            maxResults: 50,
            nextToken,
          }),
        );
        for (const summary of response.inferenceProfileSummaries ?? []) {
          if (summary.status !== 'ACTIVE' || !summary.inferenceProfileArn)
            continue;
          const hasModel = (summary.models ?? []).some((m) => {
            const arn = (m.modelArn ?? '').toLowerCase();
            return (
              arn.includes(normalizedId) || arn.endsWith('/' + normalizedId)
            );
          });
          if (hasModel) return summary.inferenceProfileArn;
        }
        nextToken = response.nextToken;
      } while (nextToken);
      return null;
    } catch (err) {
      BedrockService.staticLogger.warn(
        'ListInferenceProfiles failed when resolving profile for model',
        {
          foundationModelId,
          error: err instanceof Error ? err.message : String(err),
        },
      );
      return null;
    }
  }

  /**
   * Chat-style invoke for RAG/LLM callers: accepts messages and returns { content }.
   */
  async invoke(
    messages: Array<{ role: string; content: string }>,
  ): Promise<{ content: string }> {
    const lastUser = messages.filter((m) => m.role === 'user').pop();
    const prompt = lastUser?.content ?? '';
    const result = await this.invokeModel(prompt);
    return { content: result.response };
  }

  /**
   * Invoke model with text prompt (instance method for DI; delegates to static).
   */
  async invokeModel(
    prompt: string,
    model: string = AWS_CONFIG.bedrock.modelId,
    options: {
      maxTokens?: number;
      temperature?: number;
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      useSystemPrompt?: boolean;
      recentMessages?: Array<{ role: string; content: string }>;
    } = {},
  ): Promise<{
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    const { useSystemPrompt: _u, recentMessages: _r, ...rest } = options;
    return BedrockService.invokeModel(prompt, model, rest);
  }

  /**
   * Invoke model with text prompt
   */
  static async invokeModel(
    prompt: string,
    model: string = AWS_CONFIG.bedrock.modelId,
    options: {
      maxTokens?: number;
      temperature?: number;
      userId?: string;
      sessionId?: string;
      metadata?: Record<string, any>;
      useSystemPrompt?: boolean;
      recentMessages?: Array<{ role: string; content: string }>;
    } = {},
  ): Promise<{
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    const startTime = Date.now();
    ServiceHelper.logMethodEntry('BedrockService.invokeModel', {
      model,
      promptLength: prompt?.length,
      options,
    });

    const {
      maxTokens = BedrockService.getMaxTokensForModel(model),
      temperature = AWS_CONFIG.bedrock.temperature,
      userId,
      sessionId,
      metadata,
    } = options;

    // Estimate input tokens
    const inputTokens = estimateTokens(prompt);

    const buildCommand = (modelId: string) => {
      const isNova = modelId.toLowerCase().includes('nova');
      return isNova
        ? new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              messages: [{ role: 'user', content: [{ text: prompt }] }],
              inferenceConfig: {
                max_new_tokens: maxTokens,
                temperature: temperature,
              },
            }),
          })
        : new InvokeModelCommand({
            modelId,
            contentType: 'application/json',
            accept: 'application/json',
            body: JSON.stringify({
              anthropic_version: 'bedrock-2023-05-31',
              max_tokens: maxTokens,
              temperature: temperature,
              messages: [{ role: 'user', content: prompt }],
            }),
          });
    };

    const parseResponse = (
      modelId: string,
      responseBody: Record<string, unknown>,
    ): string => {
      if (modelId.toLowerCase().includes('nova')) {
        const output = responseBody.output as
          | Record<string, unknown>
          | undefined;
        const message = output?.message as Record<string, unknown> | undefined;
        const content = message?.content as
          | Array<Record<string, unknown>>
          | undefined;
        return (content?.[0]?.text as string) || '';
      }
      const content = responseBody.content as
        | Array<Record<string, unknown>>
        | undefined;
      return (content?.[0]?.text as string) || '';
    };

    let command = buildCommand(model);
    let activeModelId = model;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await bedrockClient.send(command);
        const responseBody = JSON.parse(
          new TextDecoder().decode(response.body),
        ) as Record<string, unknown>;

        const responseText = parseResponse(activeModelId, responseBody);

        const usage = responseBody.usage as Record<string, unknown> | undefined;
        const outputTokens =
          (usage?.output_tokens as number) ||
          (usage?.completion_tokens as number) ||
          estimateTokens(responseText);

        // Calculate cost (use original model for pricing when we used profile)
        const cost = calculateCost(
          inputTokens,
          outputTokens,
          AIProvider.AWSBedrock,
          model,
        );

        await recordGenAIUsage({
          provider: AIProvider.AWSBedrock,
          operationName: 'invokeModel',
          model,
          promptTokens: inputTokens,
          completionTokens: outputTokens,
          cost,
          userId,
          sessionId,
          metadata,
        });

        const result = {
          response: responseText,
          inputTokens,
          outputTokens,
          cost,
        };

        ServiceHelper.logMethodExit(
          'BedrockService.invokeModel',
          result,
          Date.now() - startTime,
        );
        return result;
      } catch (err) {
        lastError = err as Error;
        const msg = String(lastError.message ?? '');
        const isInferenceProfileError =
          attempt === 0 &&
          msg.includes('on-demand') &&
          msg.includes('inference profile') &&
          msg.includes('supported');

        if (isInferenceProfileError) {
          const profileArn =
            await BedrockService.findInferenceProfileArnForModel(model);
          if (profileArn) {
            BedrockService.staticLogger.log(
              'Retrying with inference profile after on-demand not supported',
              { model, profileArn: profileArn.substring(0, 60) + '...' },
            );
            command = buildCommand(profileArn);
            activeModelId = profileArn;
            continue;
          }
          // No inference profile found: retry with a known on-demand Claude model
          const onDemandFallback = 'anthropic.claude-3-5-sonnet-20241022-v2:0';
          BedrockService.staticLogger.log(
            'No inference profile for model, retrying with on-demand fallback',
            { model, fallback: onDemandFallback },
          );
          command = buildCommand(onDemandFallback);
          activeModelId = onDemandFallback;
          continue;
        }
        ServiceHelper.logMethodError('BedrockService.invokeModel', lastError, {
          model,
          promptLength: prompt?.length,
        });
        throw lastError;
      }
    }

    ServiceHelper.logMethodError('BedrockService.invokeModel', lastError!, {
      model,
      promptLength: prompt?.length,
    });
    throw lastError;
  }

  /**
   * Optimize prompt for better performance/cost
   */
  static async optimizePrompt(
    request: PromptOptimizationRequest,
  ): Promise<PromptOptimizationResponse> {
    ServiceHelper.logMethodEntry('BedrockService.optimizePrompt', request);

    try {
      const {
        prompt,
        model,
        context,
        targetReduction = 0.3,
        preserveIntent = true,
      } = request;

      // Create optimization prompt
      const optimizationPrompt = `
You are an AI prompt optimization expert. Your task is to optimize the following prompt for better performance and cost efficiency.

Original Prompt:
${prompt}

Context (if any):
${context || 'None'}

Requirements:
- Target token reduction: ${Math.round(targetReduction * 100)}%
- Preserve original intent: ${preserveIntent ? 'Yes' : 'No'}
- Make it more efficient and clear

Please provide:
1. Optimized prompt
2. Techniques used (be specific)
3. Estimated token reduction percentage
4. Additional suggestions

Format your response as JSON with keys: optimizedPrompt, techniques, estimatedTokenReduction, suggestions
`;

      const result = await this.invokeModel(optimizationPrompt, model);

      // Try to extract JSON from response
      const jsonStr = await this.extractJson(result.response);
      if (jsonStr) {
        const optimization = JSON.parse(jsonStr);
        const response: PromptOptimizationResponse = {
          optimizedPrompt: optimization.optimizedPrompt || prompt,
          techniques: optimization.techniques || ['general_optimization'],
          estimatedTokenReduction: optimization.estimatedTokenReduction || 0,
          suggestions: optimization.suggestions || [],
          alternatives: optimization.alternatives,
        };

        ServiceHelper.logMethodExit('BedrockService.optimizePrompt', response);
        return response;
      }

      // Fallback response
      const fallback: PromptOptimizationResponse = {
        optimizedPrompt: prompt,
        techniques: ['fallback'],
        estimatedTokenReduction: 0,
        suggestions: ['Unable to optimize automatically'],
      };

      ServiceHelper.logMethodExit('BedrockService.optimizePrompt', fallback);
      return fallback;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.optimizePrompt',
        error as Error,
        request,
      );
      throw error;
    }
  }

  /**
   * Analyze usage patterns and provide recommendations
   */
  static async analyzeUsagePatterns(
    request: UsageAnalysisRequest,
  ): Promise<UsageAnalysisResponse> {
    ServiceHelper.logMethodEntry('BedrockService.analyzeUsagePatterns', {
      dataPoints: request.usageData?.length,
      timeframe: request.timeframe,
    });

    try {
      const { usageData, timeframe } = request;

      if (!usageData || usageData.length === 0) {
        return {
          patterns: [],
          recommendations: ['No usage data available'],
          potentialSavings: 0,
          optimizationOpportunities: [],
        };
      }

      // Create analysis prompt
      const analysisPrompt = `
Analyze the following AI usage data and provide insights:

Usage Data (${timeframe}):
${JSON.stringify(usageData, null, 2)}

Please provide:
1. Usage patterns identified
2. Specific recommendations for optimization
3. Estimated potential savings
4. High-impact optimization opportunities

Format your response as JSON with keys: patterns, recommendations, potentialSavings, optimizationOpportunities
`;

      const result = await this.invokeModel(
        analysisPrompt,
        AWS_CONFIG.bedrock.modelId,
      );

      // Try to extract JSON from response
      const jsonStr = await this.extractJson(result.response);
      if (jsonStr) {
        const analysis = JSON.parse(jsonStr);
        const response: UsageAnalysisResponse = {
          patterns: analysis.patterns || [],
          recommendations: analysis.recommendations || [],
          potentialSavings: analysis.potentialSavings || 0,
          optimizationOpportunities: analysis.optimizationOpportunities || [],
        };

        ServiceHelper.logMethodExit(
          'BedrockService.analyzeUsagePatterns',
          response,
        );
        return response;
      }

      // Fallback response
      const fallback: UsageAnalysisResponse = {
        patterns: ['Unable to analyze patterns automatically'],
        recommendations: ['Consider manual review of usage data'],
        potentialSavings: 0,
        optimizationOpportunities: [],
      };

      ServiceHelper.logMethodExit(
        'BedrockService.analyzeUsagePatterns',
        fallback,
      );
      return fallback;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.analyzeUsagePatterns',
        error as Error,
        request,
      );
      throw error;
    }
  }

  /**
   * Suggest alternative models for cost/performance optimization
   */
  static async suggestModelAlternatives(
    currentModel: string,
    requirements: {
      useCase?: string;
      priority?: 'cost' | 'quality' | 'speed' | 'balanced';
      maxCost?: number;
      minQuality?: number;
    } = {},
  ): Promise<
    Array<{
      model: string;
      reasoning: string;
      costComparison: number;
      qualityComparison: number;
      recommended: boolean;
    }>
  > {
    ServiceHelper.logMethodEntry('BedrockService.suggestModelAlternatives', {
      currentModel,
      requirements,
    });

    try {
      const {
        useCase = 'general',
        priority = 'balanced',
        maxCost,
        minQuality,
      } = requirements;

      type ModelProfile = {
        model: string;
        relativeCost: number;
        quality: number;
        speed: number;
        useCases: string[];
      };

      const MODEL_PROFILES: ModelProfile[] = [
        {
          model: 'us.anthropic.claude-3-5-haiku-20241022-v1:0',
          relativeCost: 0.25,
          quality: 0.72,
          speed: 0.95,
          useCases: ['general', 'chat', 'classification', 'support'],
        },
        {
          model: 'us.anthropic.claude-3-5-sonnet-20241022-v2:0',
          relativeCost: 1.0,
          quality: 0.9,
          speed: 0.74,
          useCases: ['general', 'analysis', 'coding', 'creative'],
        },
        {
          model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
          relativeCost: 1.0,
          quality: 0.89,
          speed: 0.72,
          useCases: ['general', 'analysis', 'coding', 'creative'],
        },
        {
          model: 'amazon.nova-lite-v1:0',
          relativeCost: 0.18,
          quality: 0.68,
          speed: 0.96,
          useCases: ['general', 'chat', 'extraction', 'summarization'],
        },
        {
          model: 'amazon.nova-pro-v1:0',
          relativeCost: 0.5,
          quality: 0.81,
          speed: 0.84,
          useCases: ['general', 'analysis', 'coding', 'multimodal'],
        },
      ];

      const normalizedUseCase = useCase.trim().toLowerCase();
      const currentProfile = MODEL_PROFILES.find(
        (profile) => profile.model === currentModel,
      ) || {
        model: currentModel,
        relativeCost: 1.0,
        quality: 0.8,
        speed: 0.75,
        useCases: ['general'],
      };

      const candidates = MODEL_PROFILES.filter(
        (profile) => profile.model !== currentProfile.model,
      )
        .filter(
          (profile) =>
            minQuality === undefined || profile.quality * 100 >= minQuality,
        )
        .filter(
          (profile) => maxCost === undefined || profile.relativeCost <= maxCost,
        );

      const scoreProfile = (profile: ModelProfile): number => {
        const useCaseBoost = profile.useCases.includes(normalizedUseCase)
          ? 0.12
          : 0;

        switch (priority) {
          case 'cost':
            return (
              (1 - profile.relativeCost) * 0.7 +
              profile.quality * 0.2 +
              useCaseBoost
            );
          case 'quality':
            return profile.quality * 0.7 + profile.speed * 0.1 + useCaseBoost;
          case 'speed':
            return profile.speed * 0.65 + profile.quality * 0.2 + useCaseBoost;
          case 'balanced':
          default:
            return (
              (1 - profile.relativeCost) * 0.35 +
              profile.quality * 0.35 +
              profile.speed * 0.3 +
              useCaseBoost
            );
        }
      };

      const ranked = [...candidates]
        .map((profile) => ({
          profile,
          score: scoreProfile(profile),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, 4);

      const suggestions = [
        {
          model: currentProfile.model,
          reasoning: 'Current model baseline',
          costComparison: 0,
          qualityComparison: 0,
          recommended: false,
        },
        ...ranked.map(({ profile }, index) => {
          const costComparison =
            currentProfile.relativeCost > 0
              ? ((profile.relativeCost - currentProfile.relativeCost) /
                  currentProfile.relativeCost) *
                100
              : 0;
          const qualityComparison =
            currentProfile.quality > 0
              ? ((profile.quality - currentProfile.quality) /
                  currentProfile.quality) *
                100
              : 0;

          const reasoningParts: string[] = [];
          if (costComparison < 0) {
            reasoningParts.push(
              `${Math.abs(costComparison).toFixed(0)}% lower estimated cost`,
            );
          } else if (costComparison > 0) {
            reasoningParts.push(
              `${Math.abs(costComparison).toFixed(0)}% higher estimated cost`,
            );
          }
          if (qualityComparison > 0) {
            reasoningParts.push(
              `${qualityComparison.toFixed(0)}% higher quality score`,
            );
          } else if (qualityComparison < 0) {
            reasoningParts.push(
              `${Math.abs(qualityComparison).toFixed(0)}% lower quality score`,
            );
          }
          if (profile.useCases.includes(normalizedUseCase)) {
            reasoningParts.push(`optimized for ${normalizedUseCase} workloads`);
          }

          return {
            model: profile.model,
            reasoning:
              reasoningParts.length > 0
                ? reasoningParts.join('; ')
                : 'Alternative model option',
            costComparison: Math.round(costComparison),
            qualityComparison: Math.round(qualityComparison),
            recommended: index === 0,
          };
        }),
      ];

      ServiceHelper.logMethodExit(
        'BedrockService.suggestModelAlternatives',
        suggestions,
      );
      return suggestions;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.suggestModelAlternatives',
        error as Error,
        {
          currentModel,
          requirements,
        },
      );
      throw error;
    }
  }

  /**
   * Generate prompt templates for specific use cases
   */
  static async generatePromptTemplate(
    objective: string,
    context: {
      domain?: string;
      complexity?: 'simple' | 'medium' | 'complex';
      outputFormat?: string;
      constraints?: string[];
    } = {},
  ): Promise<{
    template: string;
    variables: string[];
    estimatedTokens: number;
    suggestions: string[];
  }> {
    ServiceHelper.logMethodEntry('BedrockService.generatePromptTemplate', {
      objective,
      context,
    });

    try {
      const {
        domain,
        complexity = 'medium',
        outputFormat,
        constraints,
      } = context;

      const templatePrompt = `
Generate a high-quality prompt template for the following objective:

Objective: ${objective}
Domain: ${domain || 'General'}
Complexity: ${complexity}
Output Format: ${outputFormat || 'Natural language'}
Constraints: ${constraints?.join(', ') || 'None'}

Please provide:
1. Complete prompt template with variables
2. List of variables used
3. Estimated token count
4. Usage suggestions

Format your response as JSON with keys: template, variables, estimatedTokens, suggestions
`;

      const result = await this.invokeModel(
        templatePrompt,
        AWS_CONFIG.bedrock.modelId,
      );

      // Try to extract JSON from response
      const jsonStr = await this.extractJson(result.response);
      if (jsonStr) {
        const templateData = JSON.parse(jsonStr);
        const response = {
          template: templateData.template || `Please ${objective}`,
          variables: templateData.variables || [],
          estimatedTokens:
            templateData.estimatedTokens ||
            estimateTokens(templateData.template || ''),
          suggestions: templateData.suggestions || [],
        };

        ServiceHelper.logMethodExit(
          'BedrockService.generatePromptTemplate',
          response,
        );
        return response;
      }

      // Fallback response
      const fallback = {
        template: `Please ${objective}`,
        variables: [],
        estimatedTokens: estimateTokens(`Please ${objective}`),
        suggestions: ['Generated basic template'],
      };

      ServiceHelper.logMethodExit(
        'BedrockService.generatePromptTemplate',
        fallback,
      );
      return fallback;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.generatePromptTemplate',
        error as Error,
        {
          objective,
          context,
        },
      );
      throw error;
    }
  }

  /**
   * Detect anomalies in usage patterns
   */
  static async detectAnomalies(
    recentUsage: Array<{ timestamp: Date; cost: number; tokens: number }>,
    thresholds: {
      costThreshold?: number;
      tokenThreshold?: number;
      timeWindow?: number; // hours
    } = {},
  ): Promise<{
    anomalies: Array<{
      timestamp: Date;
      type: 'cost' | 'tokens';
      severity: 'low' | 'medium' | 'high';
      description: string;
      value: number;
      threshold: number;
    }>;
    summary: {
      totalAnomalies: number;
      highestSeverity: string;
      recommendations: string[];
    };
  }> {
    ServiceHelper.logMethodEntry('BedrockService.detectAnomalies', {
      dataPoints: recentUsage?.length,
      thresholds,
    });

    try {
      const {
        costThreshold = 0.1,
        tokenThreshold = 1000,
        timeWindow = 24,
      } = thresholds;

      if (!recentUsage || recentUsage.length === 0) {
        return {
          anomalies: [],
          summary: {
            totalAnomalies: 0,
            highestSeverity: 'none',
            recommendations: ['No usage data to analyze'],
          },
        };
      }

      // Statistical anomaly detection using z-score analysis
      const anomalies = BedrockService.detectStatisticalAnomalies(
        recentUsage,
        costThreshold,
        tokenThreshold,
      );

      const response = {
        anomalies,
        summary: {
          totalAnomalies: anomalies.length,
          highestSeverity:
            anomalies.length > 0
              ? (['high', 'medium', 'low'] as const).find((sev) =>
                  anomalies.some(
                    (a: { severity: 'low' | 'medium' | 'high' }) =>
                      a.severity === sev,
                  ),
                ) || 'low'
              : 'none',
          recommendations:
            anomalies.length > 0
              ? [
                  'Review high-cost requests',
                  'Consider model optimization',
                  'Implement usage limits',
                ]
              : ['Usage patterns are within normal ranges'],
        },
      };

      ServiceHelper.logMethodExit('BedrockService.detectAnomalies', response);
      return response;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.detectAnomalies',
        error as Error,
        {
          dataPoints: recentUsage?.length,
          thresholds,
        },
      );
      throw error;
    }
  }

  /**
   * Invoke model with image (vision capabilities)
   */
  static async invokeWithImage(
    prompt: string,
    imageBase64: string,
    userId?: string,
    modelId: string = AWS_CONFIG.bedrock.modelId,
  ): Promise<{
    response: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    const startTime = Date.now();
    ServiceHelper.logMethodEntry('BedrockService.invokeWithImage', {
      promptLength: prompt?.length,
      imageSize: imageBase64?.length,
      modelId,
      userId,
    });

    try {
      // Process base64 image data
      const imageData = imageBase64.includes('base64,')
        ? imageBase64.split('base64,')[1]
        : imageBase64;

      // Validate base64 data
      if (!imageData || imageData.length === 0) {
        throw new Error('Empty base64 data');
      }

      // Test if base64 is valid
      try {
        Buffer.from(imageData, 'base64');
      } catch (error) {
        throw new Error(`Invalid base64 data: ${(error as Error).message}`);
      }

      // Determine media type from base64 prefix if available
      let mediaType = 'image/jpeg';
      if (imageBase64.includes('image/png')) {
        mediaType = 'image/png';
      } else if (imageBase64.includes('image/webp')) {
        mediaType = 'image/webp';
      } else if (imageBase64.includes('image/gif')) {
        mediaType = 'image/gif';
      }

      // Convert model ID to inference profile if needed
      const region = process.env.AWS_BEDROCK_REGION || 'us-east-1';
      const regionPrefix = region.split('-')[0]; // us, eu, ap, etc.

      // Map of model IDs that need inference profile conversion
      const modelMappings: Record<string, string> = {
        // Anthropic Claude 3.5 models require inference profiles
        'global.anthropic.claude-haiku-4-5-20251001-v1:0': `${regionPrefix}.global.anthropic.claude-haiku-4-5-20251001-v1:0`,
        'anthropic.claude-3-5-sonnet-20240620-v1:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20240620-v1:0`,
        'anthropic.claude-3-5-sonnet-20241022-v2:0': `${regionPrefix}.anthropic.claude-3-5-sonnet-20241022-v2:0`,

        // Legacy Claude 3 models removed - use Claude 3.5+ only
        'anthropic.claude-3-haiku-20240307-v1:0': `${regionPrefix}.anthropic.claude-3-haiku-20240307-v1:0`,

        // Claude Opus 4.6, Sonnet 4.6 — require cross-region inference profiles
        'anthropic.claude-opus-4-6-v1': `${regionPrefix}.anthropic.claude-opus-4-6-v1`,
        'anthropic.claude-sonnet-4-6': `${regionPrefix}.anthropic.claude-sonnet-4-6`,
        'anthropic.claude-sonnet-4-6-v1:0': `${regionPrefix}.anthropic.claude-sonnet-4-6`, // legacy alias
        // Already-prefixed profiles — pass through unchanged
        'us.anthropic.claude-sonnet-4-6': 'us.anthropic.claude-sonnet-4-6',
        'global.anthropic.claude-sonnet-4-6': 'global.anthropic.claude-sonnet-4-6',
        'anthropic.claude-opus-4-1-20250805-v1:0': `${regionPrefix}.anthropic.claude-opus-4-1-20250805-v1:0`,

        // Add Nova Pro
        'amazon.nova-pro-v1:0': `amazon.nova-pro-v1:0`, // Nova models don't need inference profiles
      };

      const actualModelId = modelMappings[modelId] || modelId;

      if (actualModelId !== modelId) {
        BedrockService.staticLogger.log(
          `Converting model ID: ${modelId} -> ${actualModelId}`,
        );
      }

      // Build Bedrock payload
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 2000,
        temperature: 0.7,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageData,
                },
              },
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      };

      const command = new InvokeModelCommand({
        modelId: actualModelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(payload),
      });

      BedrockService.staticLogger.log('Invoking Claude with image', {
        modelId: actualModelId,
        payloadLength: JSON.stringify(payload).length,
      });

      const response = await bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      // Extract response text
      let responseText = '';
      if (responseBody.content && Array.isArray(responseBody.content)) {
        const textContent = responseBody.content.find(
          (c: any) => c.type === 'text',
        );
        responseText = textContent?.text || '';
      }

      // Get token usage
      const inputTokens = responseBody.usage?.input_tokens || 3000; // Estimate for image + text
      const outputTokens =
        responseBody.usage?.output_tokens || estimateTokens(responseText);

      // Calculate cost with the shared pricing utility.
      const cost = calculateCost(
        inputTokens,
        outputTokens,
        AIProvider.AWSBedrock,
        modelId,
      );

      // Record telemetry
      await recordGenAIUsage({
        provider: AIProvider.AWSBedrock,
        operationName: 'invokeWithImage',
        model: modelId,
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        cost,
        userId,
      });

      const result = {
        response: responseText,
        inputTokens,
        outputTokens,
        cost,
      };

      ServiceHelper.logMethodExit(
        'BedrockService.invokeWithImage',
        result,
        Date.now() - startTime,
      );
      return result;
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.invokeWithImage',
        error as Error,
        {
          modelId,
          imageSize: imageBase64?.length,
          userId,
        },
      );
      throw error;
    }
  }

  /**
   * Extract models from search text
   */
  static async extractModelsFromText(
    provider: string,
    searchText: string,
  ): Promise<LLMExtractionResult> {
    ServiceHelper.logMethodEntry('BedrockService.extractModelsFromText', {
      provider,
      textLength: searchText?.length,
    });

    try {
      const extractionPrompt = `
Extract all AI models mentioned in the following text for provider: ${provider}

Text to analyze:
${searchText}

Please return a JSON array of model objects with:
- modelId: The model identifier
- modelName: Human readable name
- inputPricePerMToken: Input price per million tokens
- outputPricePerMToken: Output price per million tokens
- contextWindow: Maximum context window
- capabilities: Array of capabilities
- category: text/multimodal/embedding/code
- isLatest: boolean indicating if it's the latest version

Only include models that have pricing information available.
Format: [{"modelId": "...", "modelName": "...", ...}]
`;

      const result = await this.invokeModel(
        extractionPrompt,
        AWS_CONFIG.bedrock.modelId,
      );

      // Try to extract JSON from response
      const jsonStr = await this.extractJson(result.response);
      if (jsonStr) {
        try {
          const models = JSON.parse(jsonStr);
          ServiceHelper.logMethodExit('BedrockService.extractModelsFromText', {
            success: true,
            extractedModels: models?.length || 0,
          });
          return {
            success: true,
            data: models,
            prompt: extractionPrompt,
            response: result.response,
          };
        } catch (parseError) {
          BedrockService.staticLogger.warn('Failed to parse extracted models', {
            parseError,
            jsonStr,
          });
        }
      }

      ServiceHelper.logMethodExit('BedrockService.extractModelsFromText', {
        success: false,
        error: 'Failed to extract models',
      });
      return {
        success: false,
        error: 'Failed to extract models from text',
        prompt: extractionPrompt,
        response: result.response,
      };
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.extractModelsFromText',
        error as Error,
        {
          provider,
          textLength: searchText?.length,
        },
      );

      return {
        success: false,
        error: (error as Error).message,
        prompt: '',
        response: '',
      };
    }
  }

  /**
   * Extract pricing from search text
   */
  static async extractPricingFromText(
    provider: string,
    searchText: string,
  ): Promise<RawPricingData[]> {
    ServiceHelper.logMethodEntry('BedrockService.extractPricingFromText', {
      provider,
      textLength: searchText?.length,
    });

    try {
      const pricingPrompt = `
Extract pricing information from the following text for provider: ${provider}

Text to analyze:
${searchText}

Please return a JSON array of pricing data objects with:
- modelId: The model identifier
- modelName: Human readable name
- inputPricePerMToken: Input price per million tokens (number)
- outputPricePerMToken: Output price per million tokens (number)
- cachedInputPricePerMToken: Optional cached input price
- contextWindow: Maximum context window (number)
- capabilities: Array of strings
- category: text/multimodal/embedding/code
- isLatest: boolean

Only extract models with clear pricing information.
Format: [{"modelId": "...", "modelName": "...", ...}]
`;

      const result = await this.invokeModel(
        pricingPrompt,
        AWS_CONFIG.bedrock.modelId,
      );

      // Try to extract JSON from response
      const jsonStr = await this.extractJson(result.response);
      if (jsonStr) {
        try {
          const pricingData = JSON.parse(jsonStr);
          ServiceHelper.logMethodExit('BedrockService.extractPricingFromText', {
            success: true,
            extractedPricing: pricingData?.length || 0,
          });
          return pricingData || [];
        } catch (parseError) {
          BedrockService.staticLogger.warn(
            'Failed to parse extracted pricing',
            {
              parseError,
              jsonStr,
            },
          );
        }
      }

      ServiceHelper.logMethodExit('BedrockService.extractPricingFromText', {
        success: false,
        error: 'Failed to extract pricing',
      });
      return [];
    } catch (error) {
      ServiceHelper.logMethodError(
        'BedrockService.extractPricingFromText',
        error as Error,
        {
          provider,
          textLength: searchText?.length,
        },
      );
      return [];
    }
  }

  /**
   * Invoke model directly with custom payload (instance method for DI).
   */
  async invokeModelDirectly(
    modelId: string,
    payload: any,
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    return BedrockService.invokeModelDirectly(modelId, payload);
  }

  /**
   * Invoke model directly with custom payload (static).
   */
  static async invokeModelDirectly(
    modelId: string,
    payload: any,
  ): Promise<{ response: string; inputTokens: number; outputTokens: number }> {
    const command = new InvokeModelCommand({
      modelId,
      contentType: 'application/json',
      accept: 'application/json',
      body: JSON.stringify(payload),
    });

    const response = await bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    const responseText =
      responseBody.content?.[0]?.text ||
      responseBody.output?.message?.content?.[0]?.text ||
      responseBody.generation ||
      responseBody.output?.text ||
      responseBody.text ||
      '';
    const inputTokens =
      responseBody.usage?.input_tokens ||
      responseBody.usage?.inputTokens ||
      4000;
    const outputTokens =
      responseBody.usage?.output_tokens ||
      responseBody.usage?.outputTokens ||
      Math.ceil(responseText.length / 4);

    return {
      response: responseText,
      inputTokens,
      outputTokens,
    };
  }

  /**
   * Stream model response with token-level updates
   */
  async streamModelResponse(
    messages: Array<{ role: string; content: string }>,
    modelId: string = AWS_CONFIG.bedrock.modelId,
    options: {
      maxTokens?: number;
      temperature?: number;
      onChunk?: (chunk: string, done: boolean) => void | Promise<void>;
    } = {},
  ): Promise<{
    fullResponse: string;
    inputTokens: number;
    outputTokens: number;
    cost: number;
  }> {
    const { maxTokens = 1000, temperature = 0.7, onChunk } = options;

    const startTime = Date.now();

    // Convert messages to Bedrock format
    const bedrockMessages: Message[] = messages.map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: [{ text: msg.content }],
    }));

    // Create inference config (ConverseStreamCommand accepts inferenceConfig with maxTokens, temperature)
    const inferenceConfig = {
      maxTokens,
      temperature,
    };

    const command = new ConverseStreamCommand({
      modelId,
      messages: bedrockMessages,
      inferenceConfig,
    });

    let fullResponse = '';
    let inputTokens = 0;
    let outputTokens = 0;

    try {
      const response = await bedrockClient.send(command);

      if (response.stream) {
        for await (const event of response.stream) {
          if (event.metadata) {
            // Handle metadata events (usage info)
            if (event.metadata.usage) {
              inputTokens = event.metadata.usage.inputTokens || 0;
              outputTokens = event.metadata.usage.outputTokens || 0;
            }
          } else if (event.contentBlockDelta) {
            // Handle text delta events
            const delta = event.contentBlockDelta.delta;
            if (delta?.text) {
              fullResponse += delta.text;

              // Call the chunk callback if provided
              if (onChunk) {
                await onChunk(delta.text, false);
              }
            }
          }
        }
      }

      // Call the final chunk callback to indicate completion
      if (onChunk) {
        await onChunk('', true);
      }

      // Calculate cost (signature: inputTokens, outputTokens, provider, model)
      const cost = calculateCost(inputTokens, outputTokens, 'bedrock', modelId);

      // Record telemetry
      await recordGenAIUsage({
        provider: 'bedrock',
        operationName: 'streamConverse',
        model: modelId,
        prompt: messages[messages.length - 1]?.content || '',
        promptTokens: inputTokens,
        completionTokens: outputTokens,
        completion: fullResponse,
        cost,
        latencyMs: Date.now() - startTime,
      });

      return {
        fullResponse,
        inputTokens,
        outputTokens,
        cost,
      };
    } catch (error) {
      this.logger.error('Bedrock streaming error', {
        error: error instanceof Error ? error.message : String(error),
        modelId,
      });

      throw error;
    }
  }

  /**
   * Detect statistical anomalies using z-score analysis
   */
  private static detectStatisticalAnomalies(
    usageData: Array<{
      timestamp: Date;
      cost: number;
      tokens?: number;
      totalTokens?: number;
    }>,
    costThreshold: number,
    tokenThreshold: number,
  ): Array<{
    timestamp: Date;
    type: 'cost' | 'tokens';
    severity: 'low' | 'medium' | 'high';
    description: string;
    value: number;
    threshold: number;
    zScore: number;
  }> {
    const toTokens = (u: { tokens?: number; totalTokens?: number }): number =>
      u.totalTokens ?? u.tokens ?? 0;

    if (usageData.length < 5) {
      return usageData
        .filter(
          (usage) =>
            usage.cost > costThreshold || toTokens(usage) > tokenThreshold,
        )
        .map((usage) => ({
          timestamp: usage.timestamp,
          type: usage.cost > costThreshold ? 'cost' : 'tokens',
          severity: (usage.cost > costThreshold * 2 ||
          toTokens(usage) > tokenThreshold * 2
            ? 'high'
            : 'medium') as 'low' | 'medium' | 'high',
          description: `${usage.cost > costThreshold ? 'High cost' : 'High token usage'} detected`,
          value: usage.cost > costThreshold ? usage.cost : toTokens(usage),
          threshold:
            usage.cost > costThreshold ? costThreshold : tokenThreshold,
          zScore: 0,
        }));
    }

    const costs = usageData.map((u) => u.cost);
    const costMean = costs.reduce((sum, val) => sum + val, 0) / costs.length;
    const costStdDev = Math.sqrt(
      costs.reduce((sum, val) => sum + Math.pow(val - costMean, 2), 0) /
        costs.length,
    );

    const tokenValues = usageData.map((u) => u.totalTokens ?? u.tokens ?? 0);
    const tokenMean =
      tokenValues.reduce((sum, val) => sum + val, 0) / tokenValues.length;
    const tokenStdDev = Math.sqrt(
      tokenValues.reduce((sum, val) => sum + Math.pow(val - tokenMean, 2), 0) /
        tokenValues.length,
    );

    const anomalies: Array<{
      timestamp: Date;
      type: 'cost' | 'tokens';
      severity: 'low' | 'medium' | 'high';
      description: string;
      value: number;
      threshold: number;
      zScore: number;
    }> = [];

    for (const usage of usageData) {
      const tok = usage.totalTokens ?? usage.tokens ?? 0;
      if (costStdDev > 0) {
        const costZScore = (usage.cost - costMean) / costStdDev;
        if (costZScore > 2) {
          anomalies.push({
            timestamp: usage.timestamp,
            type: 'cost',
            severity:
              costZScore > 3 ? 'high' : costZScore > 2.5 ? 'medium' : 'low',
            description: `Cost anomaly detected (${costZScore.toFixed(2)}σ from mean)`,
            value: usage.cost,
            threshold: costMean + 2 * costStdDev,
            zScore: costZScore,
          });
        }
      }
      if (tokenStdDev > 0) {
        const tokenZScore = (tok - tokenMean) / tokenStdDev;
        if (tokenZScore > 2) {
          anomalies.push({
            timestamp: usage.timestamp,
            type: 'tokens',
            severity:
              tokenZScore > 3 ? 'high' : tokenZScore > 2.5 ? 'medium' : 'low',
            description: `Token usage anomaly detected (${tokenZScore.toFixed(2)}σ from mean)`,
            value: tok,
            threshold: tokenMean + 2 * tokenStdDev,
            zScore: tokenZScore,
          });
        }
      }
    }

    return anomalies;
  }
}

/** Alias for RAG/chat modules that need invoke(messages) -> { content } */
export type ChatBedrock = BedrockService;
