import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { Usage, UsageDocument } from '@/schemas/core/usage.schema';
import { calculateCost } from '@/utils/pricing';
import { estimateTokens } from '@/utils/tokenCounter';
import { sanitizeModelName } from '@/utils/optimizationUtils';
import { RealtimeUpdateService } from '../usage/services/realtime-update.service';

export interface TrackRequestInput {
  model: string;
  prompt?: string;
  messages?: Array<{ role: string; content: string }>;
  temperature?: number;
  maxTokens?: number;
  max_tokens?: number;
}

export interface TrackResponseInput {
  content?: string;
  choices?: Array<{ message?: { content?: string }; content?: string }>;
  usage?: {
    promptTokens?: number;
    completionTokens?: number;
    totalTokens?: number;
  };
}

export interface TrackMetadata {
  source?: string;
  ip?: string;
  userAgent?: string;
  service?: string;
  historicalSync?: boolean;
  originalCreatedAt?: Date;
  projectId?: string;
  endpoint?: string;
}

const BATCH_SIZE = 100;

@Injectable()
export class TrackerService {
  private readonly logger = new Logger(TrackerService.name);

  constructor(
    private readonly configService: ConfigService,
    @InjectModel(Usage.name) private readonly usageModel: Model<UsageDocument>,
    private readonly realtimeUpdateService: RealtimeUpdateService,
  ) {}

  /**
   * Make a tracked AI request: call the configured AI provider (OpenAI) and persist usage.
   * Requires OPENAI_API_KEY to be set. No mock or placeholder - real API call.
   */
  async makeTrackedRequest(
    request: {
      model: string;
      prompt: string;
      maxTokens?: number;
      temperature?: number;
    },
    userId: string,
    metadata?: { source?: string; ip?: string; userAgent?: string },
  ): Promise<{
    content: string;
    usage: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    };
    model: string;
  }> {
    const apiKey =
      this.configService.get<string>('OPENAI_API_KEY') ||
      process.env.OPENAI_API_KEY;
    if (!apiKey) {
      this.logger.warn(
        'makeTrackedRequest called but no OPENAI_API_KEY configured',
      );
      throw new ServiceUnavailableException(
        'No AI provider configured for tracked requests. Set OPENAI_API_KEY to enable.',
      );
    }

    const messages = [{ role: 'user' as const, content: request.prompt }];
    const maxTokens = request.maxTokens ?? 1024;
    const temperature = request.temperature ?? 0.7;

    const startTime = Date.now();
    let response: {
      content: string;
      usage: {
        promptTokens: number;
        completionTokens: number;
        totalTokens: number;
      };
    };

    try {
      const OpenAI = (await import('openai')).default;
      const client = new OpenAI({ apiKey });
      const completion = await client.chat.completions.create({
        model: request.model,
        messages,
        max_tokens: maxTokens,
        temperature,
      });

      const choice = completion.choices?.[0];
      const content = choice?.message?.content ?? '';
      const promptTokens =
        completion.usage?.prompt_tokens ?? estimateTokens(request.prompt);
      const completionTokens =
        completion.usage?.completion_tokens ?? estimateTokens(content);
      const totalTokens =
        completion.usage?.total_tokens ?? promptTokens + completionTokens;

      response = {
        content,
        usage: { promptTokens, completionTokens, totalTokens },
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`AI provider request failed: ${message}`, {
        userId,
        model: request.model,
      });
      throw error;
    }

    const requestPayload: TrackRequestInput = {
      model: request.model,
      prompt: request.prompt,
      messages,
      maxTokens,
      temperature,
    };
    const responsePayload: TrackResponseInput = {
      content: response.content,
      usage: response.usage,
    };

    await this.trackRequest(requestPayload, responsePayload, userId, {
      ...metadata,
      source: metadata?.source ?? 'api',
      service: 'openai',
      metadata: { executionTime: Date.now() - startTime },
    });

    return {
      content: response.content,
      usage: response.usage,
      model: request.model,
    };
  }

  /**
   * Persist a request/response as usage and optionally emit real-time update.
   */
  async trackRequest(
    request: TrackRequestInput,
    response: TrackResponseInput,
    userId: string,
    metadata?: TrackMetadata & { metadata?: Record<string, any> },
  ): Promise<UsageDocument> {
    const promptTokens =
      response.usage?.promptTokens ??
      (request.prompt ? estimateTokens(request.prompt) : 0);
    const completionTokens =
      response.usage?.completionTokens ??
      (response.content
        ? estimateTokens(response.content)
        : response.choices?.[0]?.message?.content
          ? estimateTokens(response.choices[0].message.content)
          : 0);
    const totalTokens =
      response.usage?.totalTokens ?? promptTokens + completionTokens;

    const content =
      response.content ??
      response.choices?.[0]?.message?.content ??
      response.choices?.[0]?.content ??
      '';
    const sanitizedModel = sanitizeModelName(request.model);
    const service = metadata?.service ?? 'openai';

    let cost: number;
    try {
      cost = calculateCost(
        promptTokens,
        completionTokens,
        service,
        sanitizedModel,
      );
    } catch {
      cost = 0;
      this.logger.warn(
        `Cost calculation failed for ${service}/${sanitizedModel}`,
      );
    }

    const createdAt = metadata?.originalCreatedAt ?? new Date();

    const usageRecord = new this.usageModel({
      userId,
      projectId: metadata?.projectId,
      service,
      model: sanitizedModel,
      prompt: request.prompt ?? '',
      completion: content,
      promptTokens,
      completionTokens,
      totalTokens,
      cost,
      responseTime: metadata?.metadata?.executionTime ?? 0,
      metadata: metadata?.metadata ?? {},
      tags: [],
      optimizationApplied: false,
      errorOccurred: false,
      createdAt,
    });

    const savedUsage = await usageRecord.save();

    if (!metadata?.historicalSync) {
      await this.realtimeUpdateService.emitUsageUpdate(userId, savedUsage);
    }

    this.logger.debug(`Usage tracked for user ${userId}: ${savedUsage._id}`);
    return savedUsage as UsageDocument;
  }

  /**
   * Sync historical usage: re-process records in the last `days` and run them through tracking.
   * Runs in background; safe to call from controller and return immediately.
   */
  async syncHistoricalData(
    userId: string,
    days: number = 30,
  ): Promise<{ synced: number; batches: number }> {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    startDate.setHours(0, 0, 0, 0);

    const historical = await this.usageModel
      .find({
        userId,
        createdAt: { $gte: startDate },
      })
      .lean()
      .exec();

    this.logger.log(
      `Syncing ${historical.length} historical records for user ${userId}`,
    );

    interface HistoricalUsage {
      userId: { toString(): string };
      model: string;
      prompt?: string;
      completion?: string;
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      service: string;
      createdAt?: Date | string;
    }

    let synced = 0;
    for (let i = 0; i < historical.length; i += BATCH_SIZE) {
      const batch = historical.slice(i, i + BATCH_SIZE) as HistoricalUsage[];
      await Promise.all(
        batch.map(async (usage) => {
          const userIdStr =
            typeof usage.userId === 'string'
              ? usage.userId
              : (usage.userId?.toString?.() ?? '');
          await this.trackRequest(
            { model: usage.model, prompt: usage.prompt ?? '' },
            {
              content: usage.completion,
              usage: {
                promptTokens: usage.promptTokens,
                completionTokens: usage.completionTokens,
                totalTokens: usage.totalTokens,
              },
            },
            userIdStr,
            {
              service: usage.service,
              historicalSync: true,
              originalCreatedAt: usage.createdAt
                ? new Date(usage.createdAt)
                : undefined,
            },
          );
          synced++;
        }),
      );
    }

    this.logger.log(
      `Historical sync completed for user ${userId}: ${synced} records`,
    );
    return { synced, batches: Math.ceil(historical.length / BATCH_SIZE) };
  }
}
