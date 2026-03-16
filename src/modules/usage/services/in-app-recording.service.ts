/**
 * In-App Recording Service (NestJS)
 *
 * Port from Express inAppRecording.service.ts.
 * Tracks in-app recording sessions and AI interactions for session replay.
 */

import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Session, SessionDocument } from '../../../schemas/misc/session.schema';
import { v4 as uuidv4 } from 'uuid';

export interface AIInteraction {
  model: string;
  prompt: string;
  response: string;
  parameters?: Record<string, unknown>;
  tokens?: { input: number; output: number };
  cost?: number;
  latency?: number;
  provider?: string;
  requestMetadata?: Record<string, unknown>;
  responseMetadata?: Record<string, unknown>;
}

@Injectable()
export class InAppRecordingService {
  private readonly logger = new Logger(InAppRecordingService.name);

  constructor(
    @InjectModel(Session.name)
    private readonly sessionModel: Model<SessionDocument>,
  ) {}

  /**
   * Start a new in-app recording session
   */
  async startRecording(
    userId: string,
    feature: string,
    metadata?: Record<string, unknown>,
  ): Promise<string> {
    const sessionId = `inapp_${feature}_${Date.now()}_${uuidv4().substring(0, 8)}`;
    this.logger.log('Starting in-app recording session', {
      sessionId,
      userId,
      feature,
    });

    await this.sessionModel.create({
      sessionId,
      userId: new Types.ObjectId(userId),
      status: 'active',
      source: 'api',
      appFeature: feature as any,
      trackingEnabled: true,
      sessionReplayEnabled: true,
      replayData: {
        aiInteractions: [],
        userActions: [],
        codeContext: [],
        systemMetrics: [],
      },
      totalInteractions: 0,
      totalCost: 0,
      totalTokens: 0,
      startedAt: new Date(),
      lastActivityAt: new Date(),
      metadata: {
        ...metadata,
        startedBy: 'in-app-recording',
        feature,
      },
    } as any);

    return sessionId;
  }

  /**
   * Record an AI interaction in the session
   */
  async recordInteraction(
    sessionId: string,
    interaction: AIInteraction,
  ): Promise<void> {
    const now = new Date();
    await this.sessionModel.updateOne(
      { sessionId },
      {
        $push: {
          'replayData.aiInteractions': {
            timestamp: now,
            model: interaction.model,
            prompt: interaction.prompt,
            response: interaction.response,
            parameters: interaction.parameters ?? {},
            tokens: interaction.tokens ?? { input: 0, output: 0 },
            cost: interaction.cost ?? 0,
            latency: interaction.latency,
            provider: interaction.provider ?? 'aws-bedrock',
            requestMetadata: interaction.requestMetadata ?? {},
            responseMetadata: interaction.responseMetadata ?? {},
          },
        },
        $inc: { totalInteractions: 1, totalCost: interaction.cost ?? 0 },
        $set: { lastActivityAt: now },
      },
    );
  }
}
