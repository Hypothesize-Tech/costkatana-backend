/**
 * Cost Intelligence Stack Configuration
 * 
 * Centralized configuration for all 6 layers of the cost intelligence stack.
 * Supports environment variables, runtime updates, and feature flags.
 */

import { loggingService } from '../services/logging.service';

export interface CostIntelligenceConfig {
  // Layer 1: Telemetry
  telemetry: {
    enabled: boolean;
    sampleRate: number; // 0-1, percentage of requests to sample
    streaming: {
      enabled: boolean;
      heartbeatInterval: number; // ms
      clientTimeout: number; // ms
    };
    failSafe: boolean; // Continue on telemetry errors
  };

  // Layer 2: Intelligence
  intelligence: {
    enabled: boolean;
    continuousAnalysis: boolean;
    intervals: {
      fast: number; // ms
      medium: number; // ms
      slow: number; // ms
    };
    anomalyDetection: {
      enabled: boolean;
      spikeThreshold: number; // percentage increase
    };
    recommendations: boolean;
  };

  // Layer 3: Routing
  routing: {
    enabled: boolean;
    useTelemetryData: boolean;
    fallbackStrategy: 'cost' | 'speed' | 'quality' | 'balanced';
    planTierMapping: {
      free: 'fast' | 'balanced' | 'premium' | 'expert';
      plus: 'fast' | 'balanced' | 'premium' | 'expert';
      pro: 'fast' | 'balanced' | 'premium' | 'expert';
      enterprise: 'fast' | 'balanced' | 'premium' | 'expert';
    };
  };

  // Layer 4: Enforcement
  enforcement: {
    enabled: boolean;
    preFlightChecks: boolean;
    hardLimits: boolean;
    softLimitThresholds: {
      free: number;
      plus: number;
      pro: number;
      enterprise: number;
    };
    allowDowngrade: boolean;
    budgetReservation: {
      enabled: boolean;
      ttl: number; // ms
    };
  };

  // Layer 5: Caching
  caching: {
    enabled: boolean;
    strategies: {
      exact: boolean;
      semantic: boolean;
      deduplication: boolean;
    };
    semanticCache: {
      enabledByDefault: boolean;
      similarityThreshold: number; // 0-1
      ttl: number; // seconds
    };
    warmingEnabled: boolean;
  };

  // Layer 6: Simulation
  simulation: {
    enabled: boolean;
    includeAlternatives: boolean;
    maxAlternatives: number;
    trackAccuracy: boolean;
    confidenceThreshold: number; // 0-1
  };

  // Global settings
  global: {
    failOpen: boolean; // Allow requests on system errors
    performanceMode: 'low' | 'medium' | 'high'; // Trade-off between features and performance
    logging: {
      level: 'debug' | 'info' | 'warn' | 'error';
      includeMetrics: boolean;
    };
  };
}

/**
 * Default configuration
 */
const DEFAULT_CONFIG: CostIntelligenceConfig = {
  telemetry: {
    enabled: true,
    sampleRate: parseFloat(process.env.TELEMETRY_SAMPLE_RATE || '0.1'),
    streaming: {
      enabled: true,
      heartbeatInterval: 30000,
      clientTimeout: 65000
    },
    failSafe: true
  },

  intelligence: {
    enabled: true,
    continuousAnalysis: process.env.CONTINUOUS_INTELLIGENCE === 'true',
    intervals: {
      fast: 5 * 60 * 1000,
      medium: 15 * 60 * 1000,
      slow: 60 * 60 * 1000
    },
    anomalyDetection: {
      enabled: true,
      spikeThreshold: 50
    },
    recommendations: true
  },

  routing: {
    enabled: true,
    useTelemetryData: true,
    fallbackStrategy: 'balanced',
    planTierMapping: {
      free: 'fast',
      plus: 'balanced',
      pro: 'premium',
      enterprise: 'expert'
    }
  },

  enforcement: {
    enabled: true,
    preFlightChecks: true,
    hardLimits: process.env.ENFORCE_HARD_BUDGET_LIMITS !== 'false',
    softLimitThresholds: {
      free: 0.8,
      plus: 0.85,
      pro: 0.9,
      enterprise: 0.95
    },
    allowDowngrade: true,
    budgetReservation: {
      enabled: true,
      ttl: 2 * 60 * 1000
    }
  },

  caching: {
    enabled: true,
    strategies: {
      exact: true,
      semantic: process.env.ENABLE_SEMANTIC_CACHE !== 'false',
      deduplication: true
    },
    semanticCache: {
      enabledByDefault: true,
      similarityThreshold: parseFloat(process.env.SEMANTIC_CACHE_THRESHOLD || '0.85'),
      ttl: 604800
    },
    warmingEnabled: false
  },

  simulation: {
    enabled: process.env.ENABLE_COST_SIMULATION !== 'false',
    includeAlternatives: true,
    maxAlternatives: 5,
    trackAccuracy: true,
    confidenceThreshold: 0.7
  },

  global: {
    failOpen: true,
    performanceMode: (process.env.COST_INTELLIGENCE_PERFORMANCE_MODE || 'medium') as 'low' | 'medium' | 'high',
    logging: {
      level: (process.env.LOG_LEVEL || 'info') as 'debug' | 'info' | 'warn' | 'error',
      includeMetrics: true
    }
  }
};

/**
 * Cost Intelligence Configuration Manager
 */
export class CostIntelligenceConfigManager {
  private static instance: CostIntelligenceConfigManager;
  private config: CostIntelligenceConfig;
  private updateCallbacks: Array<(config: CostIntelligenceConfig) => void> = [];

  private constructor() {
    this.config = { ...DEFAULT_CONFIG };
    loggingService.info('💡 Cost Intelligence Configuration initialized');
  }

  static getInstance(): CostIntelligenceConfigManager {
    if (!CostIntelligenceConfigManager.instance) {
      CostIntelligenceConfigManager.instance = new CostIntelligenceConfigManager();
    }
    return CostIntelligenceConfigManager.instance;
  }

  /**
   * Get current configuration
   */
  getConfig(): Readonly<CostIntelligenceConfig> {
    return Object.freeze({ ...this.config });
  }

  /**
   * Get specific layer configuration
   */
  getLayerConfig<K extends keyof CostIntelligenceConfig>(
    layer: K
  ): Readonly<CostIntelligenceConfig[K]> {
    return Object.freeze({ ...this.config[layer] });
  }

  /**
   * Check if a feature is enabled
   */
  isFeatureEnabled(layer: keyof CostIntelligenceConfig, feature?: string): boolean {
    const layerConfig = this.config[layer] as any;
    
    if (!layerConfig.enabled) {
      return false;
    }

    if (feature) {
      return layerConfig[feature] === true;
    }

    return true;
  }

  /**
   * Update configuration at runtime
   */
  updateConfig(updates: Partial<CostIntelligenceConfig>): void {
    this.config = this.mergeConfig(this.config, updates);
    
    loggingService.info('Cost Intelligence Configuration updated', {
      updates: Object.keys(updates)
    });

    // Notify callbacks
    this.updateCallbacks.forEach(callback => {
      try {
        callback(this.config);
      } catch (error) {
        loggingService.error('Config update callback failed', {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    });
  }

  /**
   * Update specific layer configuration
   */
  updateLayerConfig<K extends keyof CostIntelligenceConfig>(
    layer: K,
    updates: Partial<CostIntelligenceConfig[K]>
  ): void {
    this.config[layer] = {
      ...this.config[layer],
      ...updates
    };

    loggingService.info(`${layer} configuration updated`, { updates });

    // Notify callbacks
    this.updateCallbacks.forEach(callback => callback(this.config));
  }

  /**
   * Register callback for configuration updates
   */
  onConfigUpdate(callback: (config: CostIntelligenceConfig) => void): void {
    this.updateCallbacks.push(callback);
  }

  /**
   * Reset to default configuration
   */
  resetToDefaults(): void {
    this.config = { ...DEFAULT_CONFIG };
    loggingService.info('Cost Intelligence Configuration reset to defaults');
    this.updateCallbacks.forEach(callback => callback(this.config));
  }

  /**
   * Get performance-optimized configuration
   */
  getPerformanceConfig(): {
    shouldSample: boolean;
    shouldRunIntelligence: boolean;
    shouldSimulate: boolean;
    cacheStrategy: 'all' | 'exact_only' | 'none';
  } {
    const mode = this.config.global.performanceMode;

    switch (mode) {
      case 'low':
        // Minimal features for maximum performance
        return {
          shouldSample: this.config.telemetry.sampleRate > 0.05,
          shouldRunIntelligence: false,
          shouldSimulate: false,
          cacheStrategy: 'exact_only'
        };

      case 'medium':
        // Balanced approach
        return {
          shouldSample: true,
          shouldRunIntelligence: this.config.intelligence.continuousAnalysis,
          shouldSimulate: this.config.simulation.enabled,
          cacheStrategy: 'all'
        };

      case 'high':
        // All features enabled
        return {
          shouldSample: true,
          shouldRunIntelligence: true,
          shouldSimulate: true,
          cacheStrategy: 'all'
        };

      default:
        return {
          shouldSample: true,
          shouldRunIntelligence: true,
          shouldSimulate: true,
          cacheStrategy: 'all'
        };
    }
  }

  /**
   * Validate configuration
   */
  validateConfig(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Validate telemetry
    if (this.config.telemetry.sampleRate < 0 || this.config.telemetry.sampleRate > 1) {
      errors.push('Telemetry sample rate must be between 0 and 1');
    }

    // Validate caching
    if (this.config.caching.semanticCache.similarityThreshold < 0 || 
        this.config.caching.semanticCache.similarityThreshold > 1) {
      errors.push('Semantic cache similarity threshold must be between 0 and 1');
    }

    // Validate simulation
    if (this.config.simulation.confidenceThreshold < 0 || 
        this.config.simulation.confidenceThreshold > 1) {
      errors.push('Simulation confidence threshold must be between 0 and 1');
    }

    // Validate enforcement thresholds
    for (const [tier, threshold] of Object.entries(this.config.enforcement.softLimitThresholds)) {
      if (threshold < 0 || threshold > 1) {
        errors.push(`Soft limit threshold for ${tier} must be between 0 and 1`);
      }
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Export configuration for debugging
   */
  exportConfig(): string {
    return JSON.stringify(this.config, null, 2);
  }

  /**
   * Deep merge configuration objects
   */
  private mergeConfig(
    target: CostIntelligenceConfig,
    source: Partial<CostIntelligenceConfig>
  ): CostIntelligenceConfig {
    const result = { ...target };

    for (const key in source) {
      if (source.hasOwnProperty(key)) {
        const sourceValue = source[key as keyof CostIntelligenceConfig];
        const targetValue = target[key as keyof CostIntelligenceConfig];

        if (sourceValue && typeof sourceValue === 'object' && !Array.isArray(sourceValue)) {
          (result as any)[key] = this.mergeConfig(targetValue as any, sourceValue as any);
        } else {
          (result as any)[key] = sourceValue;
        }
      }
    }

    return result;
  }
}

// Export singleton instance
export const costIntelligenceConfig = CostIntelligenceConfigManager.getInstance();

// Export default config for reference
export { DEFAULT_CONFIG };

