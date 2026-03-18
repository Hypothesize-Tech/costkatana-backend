export {
  AILoggerService,
  type AILogEntry,
} from '../common/services/ai-logger.service';

import type { AILogEntry } from '../common/services/ai-logger.service';
import type { AILoggerService as AILoggerServiceType } from '../common/services/ai-logger.service';

let _aiLoggerInstance: AILoggerServiceType | null = null;

export function setAiLoggerInstance(instance: AILoggerServiceType): void {
  _aiLoggerInstance = instance;
}

export const aiLogger = {
  logRequest: (_entry: unknown) => {},
  logResponse: (_entry: unknown) => {},
  logError: (_entry: unknown) => {},
  logAICall: async (entry: unknown) =>
    _aiLoggerInstance?.logAICall(entry as AILogEntry),
};
