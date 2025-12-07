/**
 * Agent Governance Configuration
 * Centralized configuration for AI governance system
 */

export interface AgentGovernanceConfig {
  enabled: boolean;
  overrideKey?: string;
  
  sandbox: {
    defaultIsolation: 'process' | 'container' | 'vm';
    maxCpuCores: number;
    maxMemoryMB: number;
    maxDiskMB: number;
    defaultTimeoutSeconds: number;
  };
  
  rateLimit: {
    defaultRequestsPerMinute: number;
    defaultRequestsPerHour: number;
    defaultConcurrentExecutions: number;
  };
  
  budget: {
    defaultBudgetPerRequest: number;
    defaultBudgetPerDay: number;
    defaultBudgetPerMonth: number;
  };
  
  audit: {
    level: 'minimal' | 'standard' | 'comprehensive' | 'forensic';
    retentionDays: number;
    requireReasoningCapture: boolean;
  };
}

export const DEFAULT_AGENT_GOVERNANCE_CONFIG: AgentGovernanceConfig = {
  enabled: process.env.GOVERNANCE_ENABLED === 'true' || true,
  overrideKey: process.env.GOVERNANCE_OVERRIDE_KEY,
  
  sandbox: {
    defaultIsolation: (process.env.SANDBOX_DEFAULT_ISOLATION as any) || 'container',
    maxCpuCores: parseFloat(process.env.SANDBOX_MAX_CPU_CORES || '0.5'),
    maxMemoryMB: parseInt(process.env.SANDBOX_MAX_MEMORY_MB || '512'),
    maxDiskMB: parseInt(process.env.SANDBOX_MAX_DISK_MB || '100'),
    defaultTimeoutSeconds: parseInt(process.env.SANDBOX_DEFAULT_TIMEOUT || '300')
  },
  
  rateLimit: {
    defaultRequestsPerMinute: parseInt(process.env.AGENT_DEFAULT_REQUESTS_PER_MINUTE || '10'),
    defaultRequestsPerHour: parseInt(process.env.AGENT_DEFAULT_REQUESTS_PER_HOUR || '100'),
    defaultConcurrentExecutions: parseInt(process.env.AGENT_DEFAULT_CONCURRENT_EXECUTIONS || '2')
  },
  
  budget: {
    defaultBudgetPerRequest: parseFloat(process.env.AGENT_DEFAULT_BUDGET_PER_REQUEST || '0.10'),
    defaultBudgetPerDay: parseFloat(process.env.AGENT_DEFAULT_BUDGET_PER_DAY || '1.00'),
    defaultBudgetPerMonth: parseFloat(process.env.AGENT_DEFAULT_BUDGET_PER_MONTH || '10.00')
  },
  
  audit: {
    level: (process.env.AGENT_AUDIT_LEVEL as any) || 'comprehensive',
    retentionDays: parseInt(process.env.AGENT_AUDIT_RETENTION_DAYS || '2555'),
    requireReasoningCapture: process.env.AGENT_AUDIT_REQUIRE_REASONING !== 'false'
  }
};

/**
 * Get agent governance configuration
 */
export function getAgentGovernanceConfig(): AgentGovernanceConfig {
  return DEFAULT_AGENT_GOVERNANCE_CONFIG;
}

/**
 * Validate governance configuration
 */
export function validateGovernanceConfig(config: AgentGovernanceConfig): boolean {
  // Validate sandbox limits
  if (config.sandbox.maxCpuCores <= 0 || config.sandbox.maxCpuCores > 8) {
    throw new Error('Invalid sandbox CPU cores configuration');
  }
  
  if (config.sandbox.maxMemoryMB < 128 || config.sandbox.maxMemoryMB > 8192) {
    throw new Error('Invalid sandbox memory configuration');
  }
  
  // Validate rate limits
  if (config.rateLimit.defaultRequestsPerMinute <= 0) {
    throw new Error('Invalid rate limit configuration');
  }
  
  // Validate budget
  if (config.budget.defaultBudgetPerRequest <= 0) {
    throw new Error('Invalid budget configuration');
  }
  
  return true;
}

