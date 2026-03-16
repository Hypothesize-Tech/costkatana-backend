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
  userId?: string;
  metadata?: Record<string, unknown>;
}

export interface AICostSummary {
  totalCalls: number;
  totalCost: number;
  byService: Record<string, { calls: number; cost: number }>;
  byOperation: Record<string, { calls: number; cost: number }>;
  topExpensive: AICallRecord[];
}
