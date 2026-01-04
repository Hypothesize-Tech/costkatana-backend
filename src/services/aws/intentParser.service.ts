import { loggingService } from '../logging.service';
import { dslParserService } from './dslParser.service';
import { permissionBoundaryService } from './permissionBoundary.service';
import {
  ParsedIntent,
  IntentEntities,
  RiskLevel,
  ALLOWED_ACTIONS,
} from '../../types/awsDsl.types';

/**
 * Intent Parser Service - Natural Language to Structured Intent
 * 
 * Security Guarantees:
 * - Natural language to structured intent (using AI)
 * - Entity extraction: service, action, resources, parameters
 * - Risk level classification: low/medium/high/critical
 * - Confidence scoring
 * - Blocked command detection
 * - LLM never sees credentials
 */

// Commands that are ALWAYS blocked
const BLOCKED_COMMANDS = [
  // Destructive keywords
  'delete all',
  'terminate all',
  'destroy',
  'wipe',
  'remove everything',
  'delete everything',
  
  // IAM/Security keywords
  'create user',
  'create role',
  'create policy',
  'modify iam',
  'change permissions',
  'grant access',
  'revoke access',
  
  // Billing keywords
  'change billing',
  'modify billing',
  'payment',
  'credit card',
  
  // Organization keywords
  'organization',
  'account settings',
];

// Intent patterns for common requests
const INTENT_PATTERNS: Array<{
  patterns: RegExp[];
  action: string;
  service: string;
  riskLevel: RiskLevel;
}> = [
  // EC2 Stop
  {
    patterns: [
      /stop\s+(ec2\s+)?instance/i,
      /shut\s*down\s+(ec2\s+)?instance/i,
      /turn\s+off\s+(ec2\s+)?instance/i,
      /stop\s+running\s+instance/i,
    ],
    action: 'ec2.stop',
    service: 'ec2',
    riskLevel: 'medium',
  },
  
  // EC2 Start
  {
    patterns: [
      /start\s+(ec2\s+)?instance/i,
      /turn\s+on\s+(ec2\s+)?instance/i,
      /boot\s+(ec2\s+)?instance/i,
    ],
    action: 'ec2.start',
    service: 'ec2',
    riskLevel: 'medium',
  },
  
  // EC2 Resize
  {
    patterns: [
      /resize\s+(ec2\s+)?instance/i,
      /change\s+instance\s+type/i,
      /modify\s+instance\s+size/i,
      /scale\s+(ec2\s+)?instance/i,
    ],
    action: 'ec2.resize',
    service: 'ec2',
    riskLevel: 'high',
  },
  
  // S3 Lifecycle
  {
    patterns: [
      /s3\s+lifecycle/i,
      /bucket\s+lifecycle/i,
      /configure\s+lifecycle/i,
      /set\s+lifecycle\s+policy/i,
    ],
    action: 's3.lifecycle',
    service: 's3',
    riskLevel: 'medium',
  },
  
  // S3 Intelligent Tiering
  {
    patterns: [
      /intelligent\s+tiering/i,
      /enable\s+tiering/i,
      /auto\s+tiering/i,
      /s3\s+tiering/i,
    ],
    action: 's3.intelligent_tiering',
    service: 's3',
    riskLevel: 'low',
  },
  
  // RDS Stop
  {
    patterns: [
      /stop\s+(rds\s+)?(database|db)/i,
      /shut\s*down\s+(rds\s+)?(database|db)/i,
      /stop\s+rds/i,
    ],
    action: 'rds.stop',
    service: 'rds',
    riskLevel: 'high',
  },
  
  // RDS Start
  {
    patterns: [
      /start\s+(rds\s+)?(database|db)/i,
      /turn\s+on\s+(rds\s+)?(database|db)/i,
      /start\s+rds/i,
    ],
    action: 'rds.start',
    service: 'rds',
    riskLevel: 'medium',
  },
  
  // RDS Snapshot
  {
    patterns: [
      /create\s+(rds\s+)?snapshot/i,
      /backup\s+(rds\s+)?(database|db)/i,
      /snapshot\s+(rds|database|db)/i,
    ],
    action: 'rds.snapshot',
    service: 'rds',
    riskLevel: 'low',
  },
  
  // Lambda Memory
  {
    patterns: [
      /lambda\s+memory/i,
      /change\s+function\s+memory/i,
      /update\s+lambda\s+memory/i,
      /modify\s+memory/i,
    ],
    action: 'lambda.update_memory',
    service: 'lambda',
    riskLevel: 'medium',
  },
  
  // Lambda Timeout
  {
    patterns: [
      /lambda\s+timeout/i,
      /change\s+function\s+timeout/i,
      /update\s+lambda\s+timeout/i,
      /modify\s+timeout/i,
    ],
    action: 'lambda.update_timeout',
    service: 'lambda',
    riskLevel: 'low',
  },
  
  // Cost optimization general
  {
    patterns: [
      /reduce\s+(aws\s+)?cost/i,
      /save\s+money/i,
      /optimize\s+cost/i,
      /cut\s+spending/i,
      /lower\s+bill/i,
    ],
    action: 'analyze', // Special action for analysis
    service: 'multi',
    riskLevel: 'low',
  },
  
  // Cleanup unused resources
  {
    patterns: [
      /clean\s*up\s+unused/i,
      /remove\s+idle/i,
      /stop\s+idle/i,
      /find\s+unused/i,
    ],
    action: 'cleanup',
    service: 'multi',
    riskLevel: 'medium',
  },
];

// Entity extraction patterns
const ENTITY_PATTERNS = {
  instanceId: /i-[0-9a-f]{8,17}/gi,
  volumeId: /vol-[0-9a-f]{8,17}/gi,
  bucketName: /(?:bucket|s3:\/\/)([a-z0-9][a-z0-9.-]{1,61}[a-z0-9])/gi,
  dbInstanceId: /(?:db|rds|database)[:\s]+([a-zA-Z][a-zA-Z0-9-]*)/gi,
  functionName: /(?:function|lambda)[:\s]+([a-zA-Z][a-zA-Z0-9-_]*)/gi,
  region: /(?:region|in)\s+(us-east-1|us-west-2|eu-west-1|ap-southeast-1|[a-z]{2}-[a-z]+-\d)/gi,
  tag: /tag[:\s]+([a-zA-Z0-9-_]+)[:\s]*=?\s*([a-zA-Z0-9-_]+)?/gi,
  instanceType: /(t[23]\.(nano|micro|small|medium|large|xlarge|2xlarge)|m[56]\.(large|xlarge|2xlarge|4xlarge)|c[56]\.(large|xlarge|2xlarge|4xlarge))/gi,
  memorySize: /(\d+)\s*(mb|MB|gb|GB)/gi,
  timeout: /timeout[:\s]+(\d+)\s*(s|seconds?|m|minutes?)?/gi,
};

class IntentParserService {
  private static instance: IntentParserService;
  
  private constructor() {}
  
  public static getInstance(): IntentParserService {
    if (!IntentParserService.instance) {
      IntentParserService.instance = new IntentParserService();
    }
    return IntentParserService.instance;
  }
  
  /**
   * Parse natural language request into structured intent
   * This is the main entry point
   */
  public async parseIntent(request: string): Promise<ParsedIntent> {
    const warnings: string[] = [];
    
    // Check for blocked commands first
    const blockCheck = this.checkBlockedCommands(request);
    if (blockCheck.blocked) {
      loggingService.warn('Blocked command detected', {
        component: 'IntentParserService',
        operation: 'parseIntent',
        reason: blockCheck.reason,
      });
      
      return {
        originalRequest: request,
        interpretedAction: 'BLOCKED',
        confidence: 1.0,
        entities: {},
        riskLevel: 'critical',
        warnings: [],
        blocked: true,
        blockReason: blockCheck.reason,
      };
    }
    
    // Match against intent patterns
    const matchedIntent = this.matchIntentPatterns(request);
    
    // Extract entities
    const entities = this.extractEntities(request);
    
    // Determine risk level
    const riskLevel = this.determineRiskLevel(matchedIntent, entities);
    
    // Calculate confidence
    const confidence = this.calculateConfidence(matchedIntent, entities);
    
    // Add warnings for low confidence
    if (confidence < 0.5) {
      warnings.push('Low confidence in intent interpretation - please review carefully');
    }
    
    // Add warnings for high-risk actions
    if (riskLevel === 'high' || riskLevel === 'critical') {
      warnings.push('This is a high-risk action that will modify resources');
    }
    
    // Check if action is allowed
    let suggestedAction = matchedIntent?.action;
    if (suggestedAction && !dslParserService.isActionAllowed(suggestedAction)) {
      if (suggestedAction !== 'analyze' && suggestedAction !== 'cleanup') {
        warnings.push(`Action '${suggestedAction}' is not in the allowed list`);
        suggestedAction = undefined;
      }
    }
    
    const result: ParsedIntent = {
      originalRequest: request,
      interpretedAction: this.generateInterpretation(matchedIntent, entities),
      confidence,
      entities,
      riskLevel,
      suggestedAction,
      warnings,
      blocked: false,
    };
    
    loggingService.info('Intent parsed', {
      component: 'IntentParserService',
      operation: 'parseIntent',
      interpretedAction: result.interpretedAction,
      confidence,
      riskLevel,
      suggestedAction,
    });
    
    return result;
  }
  
  /**
   * Check for blocked commands
   */
  private checkBlockedCommands(request: string): { blocked: boolean; reason?: string } {
    const lowerRequest = request.toLowerCase();
    
    for (const blocked of BLOCKED_COMMANDS) {
      if (lowerRequest.includes(blocked)) {
        return {
          blocked: true,
          reason: `Command contains blocked phrase: "${blocked}"`,
        };
      }
    }
    
    // Check for permission boundary violations
    const bannedActions = permissionBoundaryService.getBannedActions();
    for (const banned of bannedActions) {
      const actionName = banned.split(':')[1]?.toLowerCase();
      if (actionName && lowerRequest.includes(actionName.replace('*', ''))) {
        return {
          blocked: true,
          reason: `Command appears to request banned action: ${banned}`,
        };
      }
    }
    
    return { blocked: false };
  }
  
  /**
   * Match request against intent patterns
   */
  private matchIntentPatterns(request: string): typeof INTENT_PATTERNS[0] | null {
    for (const intent of INTENT_PATTERNS) {
      for (const pattern of intent.patterns) {
        if (pattern.test(request)) {
          return intent;
        }
      }
    }
    return null;
  }
  
  /**
   * Extract entities from the request
   */
  private extractEntities(request: string): IntentEntities {
    const entities: IntentEntities = {};
    
    // Extract instance IDs
    const instanceIds = request.match(ENTITY_PATTERNS.instanceId);
    if (instanceIds) {
      entities.resources = instanceIds;
    }
    
    // Extract volume IDs
    const volumeIds = request.match(ENTITY_PATTERNS.volumeId);
    if (volumeIds) {
      entities.resources = [...(entities.resources || []), ...volumeIds];
    }
    
    // Extract bucket names
    const bucketMatches = [...request.matchAll(ENTITY_PATTERNS.bucketName)];
    if (bucketMatches.length > 0) {
      entities.resources = [...(entities.resources || []), ...bucketMatches.map(m => m[1])];
    }
    
    // Extract regions
    const regionMatches = [...request.matchAll(ENTITY_PATTERNS.region)];
    if (regionMatches.length > 0) {
      entities.regions = regionMatches.map(m => m[1]);
    }
    
    // Extract parameters
    const params: Record<string, any> = {};
    
    // Instance type
    const instanceTypeMatch = request.match(ENTITY_PATTERNS.instanceType);
    if (instanceTypeMatch) {
      params.instanceType = instanceTypeMatch[0];
    }
    
    // Memory size
    const memoryMatch = request.match(ENTITY_PATTERNS.memorySize);
    if (memoryMatch) {
      let memory = parseInt(memoryMatch[1]);
      if (memoryMatch[2].toLowerCase().startsWith('g')) {
        memory *= 1024;
      }
      params.memorySize = memory;
    }
    
    // Timeout
    const timeoutMatches = [...request.matchAll(ENTITY_PATTERNS.timeout)];
    if (timeoutMatches.length > 0) {
      let timeout = parseInt(timeoutMatches[0][1]);
      if (timeoutMatches[0][2]?.toLowerCase().startsWith('m')) {
        timeout *= 60;
      }
      params.timeout = timeout;
    }
    
    // Tags
    const tagMatches = [...request.matchAll(ENTITY_PATTERNS.tag)];
    if (tagMatches.length > 0) {
      entities.filters = entities.filters || {};
      for (const match of tagMatches) {
        (entities.filters as Record<string, any>)[`tag:${match[1]}`] = match[2] || '*';
      }
    }
    
    if (Object.keys(params).length > 0) {
      entities.parameters = params;
    }
    
    return entities;
  }
  
  /**
   * Determine risk level based on intent and entities
   */
  private determineRiskLevel(
    intent: typeof INTENT_PATTERNS[0] | null,
    entities: IntentEntities
  ): RiskLevel {
    // Start with intent's risk level
    let riskLevel: RiskLevel = intent?.riskLevel || 'medium';
    
    // Increase risk for multiple resources
    if (entities.resources && entities.resources.length > 5) {
      if (riskLevel === 'low') riskLevel = 'medium';
      else if (riskLevel === 'medium') riskLevel = 'high';
    }
    
    // Increase risk for production tags
    if (entities.filters) {
      const filterStr = JSON.stringify(entities.filters).toLowerCase();
      if (filterStr.includes('prod') || filterStr.includes('production')) {
        if (riskLevel === 'low') riskLevel = 'medium';
        else if (riskLevel === 'medium') riskLevel = 'high';
      }
    }
    
    return riskLevel;
  }
  
  /**
   * Calculate confidence score
   */
  private calculateConfidence(
    intent: typeof INTENT_PATTERNS[0] | null,
    entities: IntentEntities
  ): number {
    let confidence = 0;
    
    // Intent match
    if (intent) {
      confidence += 0.5;
    }
    
    // Entity extraction
    if (entities.resources && entities.resources.length > 0) {
      confidence += 0.2;
    }
    
    if (entities.regions && entities.regions.length > 0) {
      confidence += 0.1;
    }
    
    if (entities.parameters && Object.keys(entities.parameters).length > 0) {
      confidence += 0.1;
    }
    
    if (entities.filters && Object.keys(entities.filters).length > 0) {
      confidence += 0.1;
    }
    
    return Math.min(confidence, 1.0);
  }
  
  /**
   * Generate human-readable interpretation
   */
  private generateInterpretation(
    intent: typeof INTENT_PATTERNS[0] | null,
    entities: IntentEntities
  ): string {
    if (!intent) {
      return 'Unable to determine specific action - please provide more details';
    }
    
    const actionInfo = ALLOWED_ACTIONS.find(a => a.action === intent.action);
    
    let interpretation = actionInfo?.description || `Perform ${intent.action}`;
    
    if (entities.resources && entities.resources.length > 0) {
      interpretation += ` on ${entities.resources.length} resource(s)`;
    }
    
    if (entities.regions && entities.regions.length > 0) {
      interpretation += ` in ${entities.regions.join(', ')}`;
    }
    
    return interpretation;
  }
  
  /**
   * Get suggestions for ambiguous requests
   */
  public getSuggestions(request: string): string[] {
    const suggestions: string[] = [];
    const lowerRequest = request.toLowerCase();
    
    // Check for cost-related keywords
    if (lowerRequest.includes('cost') || lowerRequest.includes('save') || lowerRequest.includes('reduce')) {
      suggestions.push('Stop idle EC2 instances');
      suggestions.push('Configure S3 lifecycle policies');
      suggestions.push('Enable S3 Intelligent Tiering');
      suggestions.push('Stop non-production RDS instances');
    }
    
    // Check for specific service mentions
    if (lowerRequest.includes('ec2') || lowerRequest.includes('instance')) {
      suggestions.push('Stop EC2 instances');
      suggestions.push('Start EC2 instances');
      suggestions.push('Resize EC2 instances');
    }
    
    if (lowerRequest.includes('s3') || lowerRequest.includes('bucket')) {
      suggestions.push('Configure S3 lifecycle');
      suggestions.push('Enable S3 Intelligent Tiering');
    }
    
    if (lowerRequest.includes('rds') || lowerRequest.includes('database')) {
      suggestions.push('Stop RDS instance');
      suggestions.push('Create RDS snapshot');
      suggestions.push('Resize RDS instance');
    }
    
    if (lowerRequest.includes('lambda') || lowerRequest.includes('function')) {
      suggestions.push('Update Lambda memory');
      suggestions.push('Update Lambda timeout');
    }
    
    return suggestions;
  }
  
  /**
   * Get all available actions
   */
  public getAvailableActions(): typeof ALLOWED_ACTIONS {
    return ALLOWED_ACTIONS;
  }
}

export const intentParserService = IntentParserService.getInstance();
