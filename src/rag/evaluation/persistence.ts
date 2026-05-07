import mongoose from 'mongoose';
import {
  EvaluationResult,
  EvaluationResultSchema,
  IEvaluationMetrics,
} from '../../schemas/analytics/evaluation-result.schema';
import { loggingService } from '../../common/services/logging.service';

export interface PersistEvaluationInput {
  requestId: string;
  metrics: IEvaluationMetrics;
  userId?: string;
  promptTemplateId?: string;
  promptVersionId?: string;
  modelName?: string;
  provider?: string;
}

let cachedModel: mongoose.Model<EvaluationResult> | null = null;

function getModel(): mongoose.Model<EvaluationResult> | null {
  if (cachedModel) return cachedModel;
  if (mongoose.connection.readyState !== 1) return null;
  cachedModel =
    (mongoose.models[EvaluationResult.name] as mongoose.Model<EvaluationResult>) ??
    mongoose.model<EvaluationResult>(EvaluationResult.name, EvaluationResultSchema);
  return cachedModel;
}

export async function persistEvaluationResult(
  input: PersistEvaluationInput,
): Promise<void> {
  try {
    const model = getModel();
    if (!model) {
      loggingService.warn(
        'EvaluationPersistence: mongoose connection not ready, skipping',
      );
      return;
    }
    await model.findOneAndUpdate(
      { requestId: input.requestId },
      {
        $set: {
          requestId: input.requestId,
          userId: input.userId,
          promptTemplateId: input.promptTemplateId
            ? new mongoose.Types.ObjectId(input.promptTemplateId)
            : undefined,
          promptVersionId: input.promptVersionId
            ? new mongoose.Types.ObjectId(input.promptVersionId)
            : undefined,
          modelName: input.modelName,
          provider: input.provider,
          metrics: input.metrics,
        },
      },
      { upsert: true, new: true },
    );
  } catch (error) {
    loggingService.warn('EvaluationPersistence: failed to persist', {
      error: error instanceof Error ? error.message : String(error),
      requestId: input.requestId,
    });
  }
}
