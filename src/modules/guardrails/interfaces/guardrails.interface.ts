export interface PlanLimits {
  tokensPerMonth: number;
  requestsPerMonth: number;
  logsPerMonth: number;
  projects: number;
  agentTraces: number;
  seats: number;
  models?: string[];
  allowedModels?: string[];
  features: string[];
}

export interface UsageMetrics {
  tokens: number;
  requests: number;
  logs: number;
  projects: number;
  workflows: number;
  cost: number;
  period: 'daily' | 'monthly';
}

export interface GuardrailViolation {
  type: 'soft' | 'hard' | 'warning';
  metric: string;
  current: number;
  limit: number;
  percentage: number;
  message: string;
  action: 'allow' | 'throttle' | 'block';
  suggestions: string[];
}
