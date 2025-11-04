/**
 * Cortex Model Router
 * Intelligently routes Cortex queries to appropriate AWS Bedrock models
 */

import { 
  CortexQuery, 
  ModelSelection, 
  ModelCapabilities,
  RoutingPreferences 
} from '../types';
import { loggingService } from '../../services/logging.service';

interface ModelProfile {
  modelId: string;
  provider: string;
  tier: 'economy' | 'balanced' | 'premium';
  capabilities: ModelCapabilities;
  complexityThreshold: number;
  specializations: string[];
}

export class ModelRouter {
  private modelProfiles: ModelProfile[];
  
  constructor() {
    this.modelProfiles = this.initializeModelProfiles();
  }
  
  /**
   * Initialize AWS Bedrock model profiles
   */
  private initializeModelProfiles(): ModelProfile[] {
    return [
      {
        modelId: 'anthropic.claude-3-5-haiku-20241022-v1:0',
        provider: 'bedrock',
        tier: 'economy',
        capabilities: {
          maxTokens: 4096,
          supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'],
          specializations: ['general', 'quick-response', 'simple-tasks'],
          costPerToken: 0.00025, // $0.25 per 1M input tokens
          averageLatency: 500
        },
        complexityThreshold: 0.3,
        specializations: ['summarization', 'extraction', 'simple-qa']
      },
      {
        modelId: 'anthropic.claude-3-sonnet-20240229-v1:0',
        provider: 'bedrock',
        tier: 'balanced',
        capabilities: {
          maxTokens: 4096,
          supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'],
          specializations: ['general', 'analysis', 'moderate-complexity'],
          costPerToken: 0.003, // $3 per 1M input tokens
          averageLatency: 1000
        },
        complexityThreshold: 0.6,
        specializations: ['analysis', 'comparison', 'moderate-reasoning']
      },
      {
        modelId: 'anthropic.claude-3-5-sonnet-20241022-v2:0',
        provider: 'bedrock',
        tier: 'premium',
        capabilities: {
          maxTokens: 8192,
          supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'],
          specializations: ['general', 'complex-reasoning', 'creative', 'technical'],
          costPerToken: 0.003, // $3 per 1M input tokens
          averageLatency: 1500
        },
        complexityThreshold: 0.8,
        specializations: ['complex-reasoning', 'creative-writing', 'technical-analysis', 'multi-step']
      },
      {
        modelId: 'anthropic.claude-3-opus-20240229-v1:0',
        provider: 'bedrock',
        tier: 'premium',
        capabilities: {
          maxTokens: 4096,
          supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'nl', 'pl', 'ru', 'ja', 'ko', 'zh'],
          specializations: ['complex-reasoning', 'research', 'detailed-analysis'],
          costPerToken: 0.015, // $15 per 1M input tokens
          averageLatency: 2000
        },
        complexityThreshold: 0.9,
        specializations: ['research', 'complex-analysis', 'expert-reasoning']
      },
      {
        modelId: 'amazon.titan-text-express-v1',
        provider: 'bedrock',
        tier: 'economy',
        capabilities: {
          maxTokens: 8192,
          supportedLanguages: ['en'],
          specializations: ['general', 'quick-response'],
          costPerToken: 0.00013, // $0.13 per 1M input tokens
          averageLatency: 400
        },
        complexityThreshold: 0.2,
        specializations: ['basic-qa', 'simple-generation']
      },
      {
        modelId: 'amazon.nova-pro-v1:0',
        provider: 'bedrock',
        tier: 'balanced',
        capabilities: {
          maxTokens: 300000,
          supportedLanguages: ['en', 'es', 'fr', 'de', 'pt', 'it', 'ja', 'ko', 'zh'],
          specializations: ['general', 'long-context', 'document-analysis'],
          costPerToken: 0.0008, // $0.80 per 1M input tokens
          averageLatency: 800
        },
        complexityThreshold: 0.5,
        specializations: ['document-analysis', 'long-context', 'multi-document']
      },
      {
        modelId: 'meta.llama3-1-70b-instruct-v1:0',
        provider: 'bedrock',
        tier: 'balanced',
        capabilities: {
          maxTokens: 4096,
          supportedLanguages: ['en'],
          specializations: ['general', 'instruction-following'],
          costPerToken: 0.00099, // $0.99 per 1M input tokens
          averageLatency: 900
        },
        complexityThreshold: 0.5,
        specializations: ['instruction-following', 'task-completion']
      }
    ];
  }
  
  /**
   * Select the most appropriate model for a Cortex query
   */
  public async selectModel(query: CortexQuery): Promise<ModelSelection> {
    const complexity = this.analyzeComplexity(query);
    const requirements = this.extractRequirements(query);
    
    // Check if user has specific routing preferences
    if (query.routingPreferences?.preferredModels && query.routingPreferences.preferredModels.length > 0) {
      const preferred = this.findPreferredModel(query.routingPreferences);
      if (preferred) {
        return this.createModelSelection(preferred, complexity);
      }
    }
    
    // Select based on complexity and requirements
    const selectedProfile = this.selectByComplexity(complexity, requirements);
    
    // Apply cost constraints if specified
    if (query.routingPreferences?.maxCost) {
      const constrainedProfile = this.applyCostConstraints(
        selectedProfile,
        query.routingPreferences.maxCost
      );
      return this.createModelSelection(constrainedProfile, complexity);
    }
    
    return this.createModelSelection(selectedProfile, complexity);
  }
  
  /**
   * Analyze query complexity
   */
  private analyzeComplexity(query: CortexQuery): number {
    let complexity = 0;
    
    // Check frame type complexity
    const frameComplexity: Record<string, number> = {
      'query': 0.2,
      'temporal_query': 0.7,
      'multimodal_query': 0.8,
      'meta_instruction': 0.6
    };
    complexity += frameComplexity[query.frame] || 0.3;
    
    // Check number of roles (more roles = more complex)
    const roleCount = Object.keys(query.roles).length;
    complexity += Math.min(roleCount * 0.05, 0.3);
    
    // Check for nested structures
    const hasNested = this.hasNestedStructures(query.roles);
    if (hasNested) {
      complexity += 0.2;
    }
    
    // Check for multiple tasks
    const taskCount = Object.keys(query.roles).filter(k => k.startsWith('task_')).length;
    if (taskCount > 1) {
      complexity += taskCount * 0.1;
    }
    
    // Check for specific complex actions
    const complexActions = ['analyze', 'compare', 'evaluate', 'predict', 'strategize'];
    for (const action of complexActions) {
      if (JSON.stringify(query).includes(`action_${action}`)) {
        complexity += 0.1;
      }
    }
    
    // Check optimization hints
    if (query.optimizationHints?.prioritize === 'quality') {
      complexity += 0.2;
    } else if (query.optimizationHints?.prioritize === 'speed') {
      complexity -= 0.1;
    }
    
    // Normalize to 0-1 range
    return Math.min(Math.max(complexity, 0), 1);
  }
  
  /**
   * Check if roles contain nested structures
   */
  private hasNestedStructures(roles: Record<string, any>, depth: number = 0): boolean {
    if (depth > 3) return true;
    
    for (const value of Object.values(roles)) {
      if (typeof value === 'object' && value !== null) {
        if ('frame' in value && 'roles' in value) {
          return true;
        }
        if (this.hasNestedStructures(value, depth + 1)) {
          return true;
        }
      }
    }
    
    return false;
  }
  
  /**
   * Extract requirements from query
   */
  private extractRequirements(query: CortexQuery): string[] {
    const requirements: string[] = [];
    
    const queryStr = JSON.stringify(query);
    
    // Check for specific needs
    if (queryStr.includes('summarize')) requirements.push('summarization');
    if (queryStr.includes('analyze')) requirements.push('analysis');
    if (queryStr.includes('compare')) requirements.push('comparison');
    if (queryStr.includes('create') || queryStr.includes('generate')) requirements.push('creative');
    if (queryStr.includes('translate')) requirements.push('translation');
    if (queryStr.includes('predict') || queryStr.includes('forecast')) requirements.push('prediction');
    
    // Check for long context needs
    if (queryStr.length > 10000) requirements.push('long-context');
    
    return requirements;
  }
  
  /**
   * Select model based on complexity
   */
  private selectByComplexity(complexity: number, requirements: string[]): ModelProfile {
    // Filter models that meet requirements
    let candidates = this.modelProfiles;
    
    if (requirements.length > 0) {
      candidates = candidates.filter(profile => 
        requirements.some(req => 
          profile.specializations.includes(req) ||
          profile.specializations.includes('general')
        )
      );
    }
    
    // Select based on complexity threshold
    const suitable = candidates.filter(p => complexity <= p.complexityThreshold);
    
    if (suitable.length === 0) {
      // Use the most capable model if none meet threshold
      return candidates[candidates.length - 1];
    }
    
    // Choose the most economical model that meets requirements
    return suitable.sort((a, b) => 
      a.capabilities.costPerToken - b.capabilities.costPerToken
    )[0];
  }
  
  /**
   * Find preferred model from routing preferences
   */
  private findPreferredModel(preferences: RoutingPreferences): ModelProfile | null {
    for (const preferredId of preferences.preferredModels || []) {
      const profile = this.modelProfiles.find(p => p.modelId === preferredId);
      if (profile) {
        return profile;
      }
    }
    return null;
  }
  
  /**
   * Apply cost constraints to model selection
   */
  private applyCostConstraints(profile: ModelProfile, maxCost: number): ModelProfile {
    if (profile.capabilities.costPerToken <= maxCost) {
      return profile;
    }
    
    // Find cheaper alternative
    const cheaper = this.modelProfiles
      .filter(p => p.capabilities.costPerToken <= maxCost)
      .sort((a, b) => b.capabilities.costPerToken - a.capabilities.costPerToken);
    
    return cheaper[0] || this.modelProfiles[0]; // Use cheapest if none meet constraint
  }
  
  /**
   * Create model selection response
   */
  private createModelSelection(profile: ModelProfile, complexity: number): ModelSelection {
    const estimatedTokens = 1000; // Base estimate
    const estimatedCost = (estimatedTokens / 1000000) * profile.capabilities.costPerToken;
    
    loggingService.info('Model selected for Cortex query', {
      modelId: profile.modelId,
      tier: profile.tier,
      complexity,
      estimatedCost,
      reason: `Complexity: ${(complexity * 100).toFixed(1)}%, Tier: ${profile.tier}`
    });
    
    return {
      modelId: profile.modelId,
      provider: profile.provider,
      capabilities: profile.capabilities,
      estimatedCost,
      estimatedLatency: profile.capabilities.averageLatency,
      confidence: this.calculateConfidence(profile, complexity)
    };
  }
  
  /**
   * Calculate confidence in model selection
   */
  private calculateConfidence(profile: ModelProfile, complexity: number): number {
    // Higher confidence if complexity is well below threshold
    const margin = profile.complexityThreshold - complexity;
    
    if (margin > 0.3) return 0.95;
    if (margin > 0.1) return 0.85;
    if (margin > 0) return 0.75;
    return 0.65; // Model might be stretched
  }
  
  /**
   * Get model recommendations for a query
   */
  public getRecommendations(query: CortexQuery): ModelProfile[] {
    const complexity = this.analyzeComplexity(query);
    const requirements = this.extractRequirements(query);
    
    return this.modelProfiles
      .filter(profile => {
        // Check if model meets requirements
        const meetsRequirements = requirements.length === 0 ||
          requirements.some(req => 
            profile.specializations.includes(req) ||
            profile.specializations.includes('general')
          );
        
        // Check if complexity is appropriate
        const complexityFit = complexity <= profile.complexityThreshold;
        
        return meetsRequirements && complexityFit;
      })
      .sort((a, b) => {
        // Sort by cost-effectiveness
        const aScore = a.capabilities.costPerToken / a.complexityThreshold;
        const bScore = b.capabilities.costPerToken / b.complexityThreshold;
        return aScore - bScore;
      });
  }
}

/**
 * Singleton instance for easy access
 */
export const modelRouter = new ModelRouter();
