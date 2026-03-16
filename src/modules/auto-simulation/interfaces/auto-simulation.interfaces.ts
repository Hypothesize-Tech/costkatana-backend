/**
 * Auto-Simulation Module Interfaces
 *
 * Contains all shared TypeScript interfaces used throughout the auto-simulation module.
 */

export interface AutoSimulationSettingsData {
  userId: string;
  enabled: boolean;
  triggers: {
    costThreshold: number;
    tokenThreshold: number;
    expensiveModels: string[];
    allCalls: boolean;
  };
  autoOptimize: {
    enabled: boolean;
    approvalRequired: boolean;
    maxSavingsThreshold: number;
    riskTolerance: 'low' | 'medium' | 'high';
  };
  notifications: {
    email: boolean;
    dashboard: boolean;
    slack: boolean;
    slackWebhook?: string;
  };
}

export interface AutoSimulationQueueItemData {
  id: string;
  userId: string;
  usageId: string;
  status:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'approved'
    | 'rejected';
  simulationId?: string;
  optimizationOptions?: any[];
  recommendations?: any[];
  potentialSavings?: number;
  confidence?: number;
  autoApplied?: boolean;
  appliedOptimizations?: any[];
  errorMessage?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AutoSimulationQueueFilters {
  status?:
    | 'pending'
    | 'processing'
    | 'completed'
    | 'failed'
    | 'approved'
    | 'rejected';
  limit?: number;
}

export interface AutoSimulationSettingsUpdate {
  enabled?: boolean;
  triggers?: Partial<AutoSimulationSettingsData['triggers']>;
  autoOptimize?: Partial<AutoSimulationSettingsData['autoOptimize']>;
  notifications?: Partial<AutoSimulationSettingsData['notifications']>;
}

export interface OptimizationApprovalData {
  approved: boolean;
  selectedOptimizations?: number[];
}

export interface SimulationTriggerData {
  usageId: string;
}

export interface QueueProcessingResult {
  processed: number;
  errors: string[];
}
