import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';

export interface AICallRecord {
  timestamp: Date;
  service: string;
  operation: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  latency?: number;
  success?: boolean;
  error?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class IntelligenceAiCostTrackingService {
  private readonly calls: AICallRecord[] = [];
  private readonly MAX_RECORDS = 10000;

  constructor(private readonly logger: LoggerService) {}

  trackCall(record: Omit<AICallRecord, 'timestamp'>): void {
    this.calls.push({
      ...record,
      timestamp: new Date(),
    });
    if (this.calls.length > this.MAX_RECORDS) {
      this.calls.splice(0, this.calls.length - this.MAX_RECORDS);
    }
    this.logger.debug('AI call tracked', {
      service: record.service,
      operation: record.operation,
      cost: record.estimatedCost,
    });
  }
}
