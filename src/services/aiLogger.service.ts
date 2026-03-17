export {
  AILoggerService,
  type AILogEntry,
} from '../common/services/ai-logger.service';

// Stub for legacy Express middleware - use Nest AILoggerService when available
export const aiLogger = {
  logRequest: (_entry: unknown) => {},
  logResponse: (_entry: unknown) => {},
  logError: (_entry: unknown) => {},
  logAICall: async (_entry: unknown) => {},
};
