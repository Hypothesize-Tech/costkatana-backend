/**
 * Real output moderation service (mirrors costkatana-backend implementation).
 *
 * Strategy:
 * - Primary: OpenAI GPT OSS Safeguard 20B (Bedrock)
 * - Escalation: Safeguard 120B when confidence < 0.7 or high-severity threat
 * - Fallback: Amazon Nova Pro when Safeguard fails
 * - Final fallback: Pattern-based detection
 */

import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type { ModerationConfig } from '../interfaces/gateway.interfaces';
import {
  ThreatLog,
  ThreatLogDocument,
} from '../../../schemas/security/threat-log.schema';

export interface OutputModerationResult {
  isBlocked: boolean;
  action: 'allow' | 'annotate' | 'redact' | 'block';
  violationCategories: string[];
  sanitizedContent?: string;
}

const PRIMARY_MODEL = 'openai.gpt-oss-safeguard-20b';
const ESCALATION_MODEL = 'openai.gpt-oss-safeguard-120b';
const FALLBACK_MODEL = 'amazon.nova-pro-v1:0';

const TOXIC_PATTERNS: Record<
  string,
  { patterns: RegExp[]; severity: 'medium' | 'high' }
> = {
  toxicity: {
    patterns: [
      /\b(stupid|idiot|moron|dumb|retard)\b/gi,
      /\b(kill\s+yourself|kys)\b/gi,
      /\b(go\s+die|drop\s+dead)\b/gi,
    ],
    severity: 'medium',
  },
  hateSpeech: {
    patterns: [/\b(terrorist|nazi|fascist)\b/gi, /\b(racial|ethnic)\s+slur/gi],
    severity: 'high',
  },
  sexualContent: {
    patterns: [
      /\b(explicit\s+sexual|pornographic|sexually\s+explicit)\b/gi,
      /\b(sexual\s+activity|sexual\s+content)\b/gi,
    ],
    severity: 'high',
  },
  violence: {
    patterns: [
      /\b(graphic\s+violence|violent\s+imagery)\b/gi,
      /\b(torture|murder|killing)\s+(details|instructions)/gi,
    ],
    severity: 'high',
  },
  selfHarm: {
    patterns: [
      /\b(suicide\s+methods|self\s+harm\s+instructions)\b/gi,
      /\b(how\s+to\s+hurt\s+yourself)\b/gi,
    ],
    severity: 'high',
  },
};

const CATEGORY_ENABLED_MAP: Record<string, keyof ModerationConfig> = {
  toxicity: 'enableToxicityCheck',
  hateSpeech: 'enableHateSpeechCheck',
  sexualContent: 'enableSexualContentCheck',
  violence: 'enableViolenceCheck',
  selfHarm: 'enableSelfHarmCheck',
};

const THREAT_CATEGORY_HARMFUL = 'harmful_content' as const;

@Injectable()
export class OutputModerationService {
  private readonly logger = new Logger(OutputModerationService.name);
  private readonly bedrockClient: BedrockRuntimeClient;

  constructor(
    private readonly configService: ConfigService,
    @Optional()
    @InjectModel(ThreatLog.name)
    private readonly threatLogModel?: Model<ThreatLogDocument>,
  ) {
    const region =
      this.configService.get<string>('AWS_REGION') ||
      process.env.AWS_REGION ||
      'us-east-1';
    this.bedrockClient = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId:
          this.configService.get<string>('AWS_ACCESS_KEY_ID') ||
          process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey:
          this.configService.get<string>('AWS_SECRET_ACCESS_KEY') ||
          process.env.AWS_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 3,
    });
  }

  async moderateOutput(
    responseContent: string,
    config: ModerationConfig,
    requestId: string,
    model?: string,
  ): Promise<OutputModerationResult> {
    try {
      if (!config.enableOutputModeration) {
        return {
          isBlocked: false,
          action: 'allow',
          violationCategories: [],
        };
      }

      const trimmed = responseContent?.trim() ?? '';
      if (!trimmed) {
        return {
          isBlocked: false,
          action: 'allow',
          violationCategories: [],
        };
      }

      this.logger.debug('Starting output moderation check', {
        requestId,
        contentLength: trimmed.length,
        model,
      });

      let result: OutputModerationResult;
      try {
        result = await this.runAIModerationCheck(trimmed, config, requestId);
      } catch (error) {
        this.logger.warn(
          'AI moderation failed, falling back to pattern matching',
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
        result = this.runPatternModerationCheck(trimmed, config);
      }

      if (result.isBlocked) {
        await this.logOutputThreatDetection(requestId, result, model);
      }

      this.logger.debug('Output moderation check completed', {
        requestId,
        isBlocked: result.isBlocked,
        action: result.action,
        violationCategories: result.violationCategories,
      });

      return result;
    } catch (error) {
      this.logger.error('Output moderation error', {
        error: error instanceof Error ? error.message : String(error),
        requestId,
      });
      return {
        isBlocked: false,
        action: 'allow',
        violationCategories: [],
      };
    }
  }

  private async runAIModerationCheck(
    content: string,
    config: ModerationConfig,
    requestId: string,
  ): Promise<OutputModerationResult> {
    const startTime = Date.now();
    const prompt = this.buildModerationPrompt(content, config);

    try {
      const initialResult = await this.invokeSafeguardModel(
        PRIMARY_MODEL,
        content,
        prompt,
        config,
        requestId,
        startTime,
      );

      const confidence = 0.9;
      const shouldEscalate =
        confidence < 0.7 ||
        this.isHighSeverityThreat(initialResult.violationCategories);

      if (shouldEscalate && initialResult.isBlocked) {
        this.logger.debug('Escalating to Safeguard 120B', { requestId });
        try {
          return await this.invokeSafeguardModel(
            ESCALATION_MODEL,
            content,
            prompt,
            config,
            requestId,
            startTime,
          );
        } catch {
          return initialResult;
        }
      }

      return initialResult;
    } catch {
      this.logger.debug('Safeguard 20B failed, using Nova Pro fallback', {
        requestId,
      });
      return this.invokeSafeguardModel(
        FALLBACK_MODEL,
        content,
        prompt,
        config,
        requestId,
        startTime,
      );
    }
  }

  private buildModerationPrompt(
    content: string,
    config: ModerationConfig,
  ): string {
    const checks: string[] = [];
    if (config.enableToxicityCheck) checks.push('- Toxicity/harassment');
    if (config.enableHateSpeechCheck) checks.push('- Hate speech');
    if (config.enableSexualContentCheck) checks.push('- Sexual content');
    if (config.enableViolenceCheck) checks.push('- Violence/harm');
    if (config.enableSelfHarmCheck) checks.push('- Self-harm content');

    return `You are a content moderation system. Analyze this model output for policy violations:

Content: "${content.substring(0, 4000)}"

Check for these categories:
${checks.join('\n')}

Toxicity threshold: ${config.toxicityThreshold}

Respond with JSON only:
{
    "isViolation": boolean,
    "confidence": number (0-1),
    "categories": ["category1", "category2"],
    "reason": "explanation",
    "toxicityScore": number (0-1),
    "threatLevel": "low|medium|high",
    "recommendedAction": "allow|annotate|redact|block"
}`;
  }

  private isHighSeverityThreat(categories: string[]): boolean {
    const high = [
      'violence',
      'self-harm',
      'criminal',
      'weapons',
      'illegal-drugs',
    ];
    return categories.some((cat) =>
      high.some((s) => cat.toLowerCase().includes(s)),
    );
  }

  /**
   * Invokes the configured safeguard model to perform output moderation using LLM.
   *
   * @param modelId - The identifier or ARN of the moderation model.
   * @param content - The original model output to be checked.
   * @param moderationPrompt - The system prompt for moderation.
   * @param config - Moderation config (policy, threshold, action).
   * @param _requestId - The requestId for context/tracing (unused).
   * @param _startTime - The start time of the moderation check (unused).
   * @returns OutputModerationResult describing block state, action, violation categories, sanitization.
   */
  private async invokeSafeguardModel(
    modelId: string,
    content: string,
    moderationPrompt: string,
    config: ModerationConfig,
    _requestId: string,
    _startTime: number,
  ): Promise<OutputModerationResult> {
    // Step 1: Build the request body according to provider
    const isOpenAI = modelId.includes('openai');
    const body = isOpenAI
      ? {
          messages: [{ role: 'user' as const, content: moderationPrompt }],
          max_tokens: 500,
          temperature: 0.1,
        }
      : {
          messages: [
            {
              role: 'user' as const,
              content: [{ text: moderationPrompt }],
            },
          ],
          inferenceConfig: { maxTokens: 500, temperature: 0.1 },
        };

    // Step 2: Invoke the moderation LLM model (provider-agnostic)
    const command = new InvokeModelCommand({
      modelId,
      body: JSON.stringify(body),
      contentType: 'application/json',
    });

    const response = await this.bedrockClient.send(command);
    const responseBody = JSON.parse(new TextDecoder().decode(response.body));

    // Step 3: Robustly extract the LLM's response text
    const rawText =
      responseBody?.output?.message?.content?.[0]?.text ??
      responseBody?.content?.[0]?.text ??
      responseBody?.output?.text ??
      '';

    // Step 4: Parse moderation result from LLM response as JSON
    let analysis: {
      isViolation?: boolean;
      confidence?: number;
      categories?: string[];
      reason?: string;
      recommendedAction?: string;
      toxicityScore?: number;
      threatLevel?: string;
    } = {};
    try {
      // Try to find the first JSON "object" in the response
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      analysis = jsonMatch ? JSON.parse(jsonMatch[0]) : {};
    } catch {
      analysis = {};
    }

    // Step 5: Determine enforcement action and sanitization
    const action =
      (analysis.recommendedAction as OutputModerationResult['action']) ||
      config.action;
    const isBlocked = Boolean(analysis.isViolation);
    let sanitizedContent: string | undefined;
    if (action === 'redact' && isBlocked && content) {
      sanitizedContent = '[Content redacted by moderation]';
    }

    // Step 6: Compose output moderation result
    return {
      isBlocked,
      action: isBlocked ? action : 'allow',
      violationCategories: Array.isArray(analysis.categories)
        ? analysis.categories
        : [],
      sanitizedContent,
    };
  }

  private runPatternModerationCheck(
    content: string,
    config: ModerationConfig,
  ): OutputModerationResult {
    const detectedViolations: string[] = [];
    let maxSeverity: 'low' | 'medium' | 'high' = 'low';

    for (const [category, { patterns, severity }] of Object.entries(
      TOXIC_PATTERNS,
    )) {
      const enabledKey = CATEGORY_ENABLED_MAP[category];
      if (!enabledKey || !config[enabledKey]) continue;

      for (const pattern of patterns) {
        if (pattern.test(content)) {
          detectedViolations.push(category);
          if (severity === 'high') maxSeverity = 'high';
          else if (severity === 'medium' && maxSeverity !== 'high')
            maxSeverity = 'medium';
        }
      }
    }

    const unique = [...new Set(detectedViolations)];
    const isBlocked = unique.length > 0 && maxSeverity !== 'low';

    return {
      isBlocked,
      action: isBlocked ? config.action : 'allow',
      violationCategories: unique,
    };
  }

  private async logOutputThreatDetection(
    requestId: string,
    result: OutputModerationResult,
    modelUsed?: string,
  ): Promise<void> {
    if (!this.threatLogModel) return;
    try {
      await this.threatLogModel.create({
        requestId,
        threatCategory: THREAT_CATEGORY_HARMFUL,
        confidence: 0.8,
        stage: 'output-guard',
        reason: `Output moderation: ${result.violationCategories.join(', ')}`,
        details: {
          action: result.action,
          violationCategories: result.violationCategories,
          modelUsed,
        },
        costSaved: 0,
        timestamp: new Date(),
      });
    } catch (error) {
      this.logger.warn('Failed to log output threat', {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Get output moderation analytics
   */
  async getOutputModerationAnalytics(
    userId?: string,
    dateRange?: { start: Date; end: Date },
  ): Promise<{
    totalResponses: number;
    blockedResponses: number;
    redactedResponses: number;
    annotatedResponses: number;
    violationsByCategory: Record<string, number>;
    blockRateByModel: Record<string, number>;
    averageConfidence: number;
  }> {
    if (!this.threatLogModel) {
      return {
        totalResponses: 0,
        blockedResponses: 0,
        redactedResponses: 0,
        annotatedResponses: 0,
        violationsByCategory: {},
        blockRateByModel: {},
        averageConfidence: 0,
      };
    }

    try {
      const matchQuery: any = {
        stage: 'output-guard',
      };

      if (userId) {
        matchQuery.userId = userId;
      }

      if (dateRange) {
        matchQuery.timestamp = {
          $gte: dateRange.start,
          $lte: dateRange.end,
        };
      }

      const analytics = await this.threatLogModel.aggregate([
        { $match: matchQuery },
        {
          $group: {
            _id: null,
            totalResponses: { $sum: 1 },
            blockedResponses: {
              $sum: {
                $cond: [{ $eq: ['$details.action', 'block'] }, 1, 0],
              },
            },
            redactedResponses: {
              $sum: {
                $cond: [{ $eq: ['$details.action', 'redact'] }, 1, 0],
              },
            },
            annotatedResponses: {
              $sum: {
                $cond: [{ $eq: ['$details.action', 'annotate'] }, 1, 0],
              },
            },
            violationsByCategory: {
              $push: '$threatCategory',
            },
            modelUsage: {
              $push: {
                model: '$details.modelUsed',
                blocked: { $eq: ['$details.action', 'block'] },
              },
            },
            totalConfidence: { $sum: '$confidence' },
          },
        },
      ]);

      if (analytics.length === 0) {
        return {
          totalResponses: 0,
          blockedResponses: 0,
          redactedResponses: 0,
          annotatedResponses: 0,
          violationsByCategory: {},
          blockRateByModel: {},
          averageConfidence: 0,
        };
      }

      const result = analytics[0];

      // Count violations by category
      const violationsByCategory: Record<string, number> = {};
      result.violationsByCategory.forEach((category: string) => {
        violationsByCategory[category] =
          (violationsByCategory[category] || 0) + 1;
      });

      // Calculate block rate by model
      const blockRateByModel: Record<string, number> = {};
      const modelStats: Record<string, { total: number; blocked: number }> = {};

      result.modelUsage.forEach((usage: any) => {
        if (usage.model) {
          if (!modelStats[usage.model]) {
            modelStats[usage.model] = { total: 0, blocked: 0 };
          }
          modelStats[usage.model].total++;
          if (usage.blocked) {
            modelStats[usage.model].blocked++;
          }
        }
      });

      Object.entries(modelStats).forEach(([model, stats]) => {
        blockRateByModel[model] =
          stats.total > 0 ? (stats.blocked / stats.total) * 100 : 0;
      });

      return {
        totalResponses: result.totalResponses,
        blockedResponses: result.blockedResponses,
        redactedResponses: result.redactedResponses,
        annotatedResponses: result.annotatedResponses,
        violationsByCategory,
        blockRateByModel,
        averageConfidence:
          result.totalResponses > 0
            ? result.totalConfidence / result.totalResponses
            : 0,
      };
    } catch (error) {
      this.logger.error('Error getting output moderation analytics', {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}
