import { Injectable, Logger } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  Telemetry,
  TelemetryDocument,
} from '../../../schemas/core/telemetry.schema';
import { EmbeddingsService } from '../../notebook/services/embeddings.service';

export interface CostNarrativeItem {
  record_id: string;
  narrative: string;
  generated_at: string;
  from_cache: boolean;
}

/**
 * Fetches or generates cost narratives for telemetry records.
 * Uses stored cost_narrative when present; otherwise generates via EmbeddingsService and persists.
 */
@Injectable()
export class CostNarrativesService {
  private readonly logger = new Logger(CostNarrativesService.name);

  constructor(
    @InjectModel(Telemetry.name)
    private readonly telemetryModel: Model<TelemetryDocument>,
    private readonly embeddingsService: EmbeddingsService,
  ) {}

  async getCostNarratives(recordIds: string[]): Promise<CostNarrativeItem[]> {
    const results: CostNarrativeItem[] = [];
    const now = new Date().toISOString();

    for (const id of recordIds) {
      try {
        const doc = await this.telemetryModel.findById(id).lean().exec();
        if (!doc) {
          results.push({
            record_id: id,
            narrative: 'Record not found.',
            generated_at: now,
            from_cache: false,
          });
          continue;
        }

        const record = doc as TelemetryDocument & { cost_narrative?: string };
        if (record.cost_narrative && record.cost_narrative.trim()) {
          results.push({
            record_id: id,
            narrative: record.cost_narrative,
            generated_at: now,
            from_cache: true,
          });
          continue;
        }

        const narrative =
          await this.embeddingsService.generateCostNarrative(record);
        await this.telemetryModel
          .updateOne({ _id: id }, { $set: { cost_narrative: narrative } })
          .exec();

        results.push({
          record_id: id,
          narrative,
          generated_at: now,
          from_cache: false,
        });
      } catch (error) {
        this.logger.warn(`Failed to get narrative for record ${id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        results.push({
          record_id: id,
          narrative: 'Failed to generate cost narrative for this record.',
          generated_at: now,
          from_cache: false,
        });
      }
    }

    return results;
  }
}
