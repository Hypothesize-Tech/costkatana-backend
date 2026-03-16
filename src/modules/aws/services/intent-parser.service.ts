import { Injectable } from '@nestjs/common';
import { LoggerService } from '../../../common/logger/logger.service';
import { DslParserService } from './dsl-parser.service';
import { PermissionBoundaryService } from './permission-boundary.service';
import {
  ParsedIntent,
  IntentEntities,
  RiskLevel,
  ALLOWED_ACTIONS,
} from '../types/aws-dsl.types';

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
      /cleanup\s+unused/i,
      /remove\s+unused/i,
      /delete\s+unused/i,
      /clean\s+up\s+resources/i,
    ],
    action: 'cleanup',
    service: 'multi',
    riskLevel: 'high',
  },
];

@Injectable()
export class IntentParserService {
  constructor(
    private readonly logger: LoggerService,
    private readonly dslParserService: DslParserService,
    private readonly permissionBoundaryService: PermissionBoundaryService,
  ) {}

  /**
   * Parse natural language request into structured intent
   */
  parseIntent(request: string): ParsedIntent {
    const warnings: string[] = [];

    // Check for blocked commands
    const isBlocked = this.checkBlockedCommands(request);
    if (isBlocked) {
      return {
        originalRequest: request,
        interpretedAction: 'blocked',
        confidence: 1.0,
        entities: {},
        riskLevel: 'critical',
        warnings: ['Command contains blocked keywords'],
        blocked: true,
        blockReason: 'Contains blocked command patterns',
      };
    }

    // Extract entities from request
    const entities = this.extractEntities(request);

    // Match against known patterns
    const matchedPattern = this.matchPattern(request);

    let interpretedAction = matchedPattern?.action || 'unknown';
    let riskLevel = matchedPattern?.riskLevel || 'high';
    const confidence = matchedPattern ? 0.8 : 0.3;

    // Validate against permission boundaries
    const boundaryCheck = this.permissionBoundaryService.checkBoundary({
      action: interpretedAction,
      service: entities.service || matchedPattern?.service,
      parameters: entities.parameters || {},
    });

    if (!boundaryCheck.allowed) {
      warnings.push(
        `Action violates permission boundary: ${boundaryCheck.reason}`,
      );
      riskLevel = 'critical';
      interpretedAction = 'blocked';
    }

    // Enhanced entity extraction for complex requests
    if (interpretedAction !== 'blocked') {
      this.enhanceEntities(request, entities);
    }

    // Generate warnings for risky actions
    if (riskLevel === 'high' || riskLevel === 'critical') {
      warnings.push(
        'This action carries high risk and should be reviewed carefully',
      );
    }

    // Check for unclear requests
    if (interpretedAction === 'unknown' || confidence < 0.5) {
      warnings.push(
        'Request interpretation is uncertain - please be more specific',
      );
    }

    const result: ParsedIntent = {
      originalRequest: request,
      interpretedAction,
      confidence,
      entities,
      riskLevel,
      warnings,
      blocked: interpretedAction === 'blocked',
      blockReason: boundaryCheck.reason,
    };

    this.logger.log('Intent parsed', {
      component: 'IntentParserService',
      operation: 'parseIntent',
      originalRequest: request.substring(0, 100),
      interpretedAction,
      confidence,
      riskLevel,
      blocked: result.blocked,
      warningCount: warnings.length,
    });

    return result;
  }

  /**
   * Get available actions for suggestions
   */
  getSuggestions(prefix?: string): Array<{
    action: string;
    name: string;
    description: string;
    category: string;
  }> {
    let actions = ALLOWED_ACTIONS;

    if (prefix) {
      actions = actions.filter(
        (a) =>
          a.action.toLowerCase().includes(prefix.toLowerCase()) ||
          a.name.toLowerCase().includes(prefix.toLowerCase()),
      );
    }

    return actions.map((a) => ({
      action: a.action,
      name: a.name,
      description: a.description,
      category: a.category,
    }));
  }

  /**
   * Get available actions and services
   */
  getAvailableActions(): {
    actions: string[];
    services: string[];
    categories: string[];
  } {
    const actions = ALLOWED_ACTIONS.map((a) => a.action);
    const services = [
      ...new Set(ALLOWED_ACTIONS.map((a) => a.action.split(':')[0])),
    ];
    const categories = [...new Set(ALLOWED_ACTIONS.map((a) => a.category))];

    return { actions, services, categories };
  }

  /**
   * Check if request contains blocked command patterns
   */
  private checkBlockedCommands(request: string): boolean {
    const lowerRequest = request.toLowerCase();
    return BLOCKED_COMMANDS.some((blocked) =>
      lowerRequest.includes(blocked.toLowerCase()),
    );
  }

  /**
   * Extract entities from natural language request
   */
  private extractEntities(request: string): IntentEntities {
    const entities: IntentEntities = {};

    // Extract service mentions
    const servicePatterns = [
      /\b(ec2|rds|s3|lambda|cloudwatch|dynamodb|ecs)\b/gi,
      /\b(elastic\s+compute\s+cloud|relational\s+database\s+service|simple\s+storage\s+service)\b/gi,
    ];

    for (const pattern of servicePatterns) {
      const matches = request.match(pattern);
      if (matches) {
        for (const match of matches) {
          const service = this.normalizeService(match);
          if (service && !entities.service) {
            entities.service = service;
          }
        }
      }
    }

    // Extract resource IDs (simple patterns)
    const resourceIdPatterns = [
      /\bi-[\w]+/g, // EC2 instance IDs
      /\bdb:[\w-]+/g, // RDS identifiers
      /\barn:aws:[^:]+:[^:]+:[^:]+:[^/]+/g, // ARNs
    ];

    const resources: string[] = [];
    for (const pattern of resourceIdPatterns) {
      const matches = request.match(pattern);
      if (matches) {
        resources.push(...matches);
      }
    }
    entities.resources = resources;

    // Extract regions
    const regionPatterns = [
      /\b(us-east-1|us-west-2|eu-west-1|ap-southeast-1|ap-northeast-1)\b/g,
      /\b(virginia|oregon|ireland|singapore|tokyo)\b/gi,
    ];

    for (const pattern of regionPatterns) {
      const matches = request.match(pattern);
      if (matches) {
        for (const match of matches) {
          const region = this.normalizeRegion(match);
          if (region && !entities.regions) {
            entities.regions = [region];
          }
        }
      }
    }

    // Extract filters/parameters (basic)
    const filterPatterns = [
      /\b(tag|name|status|state):\s*["']?([^"'\s]+)["']?/gi,
      /\binstance-type:\s*["']?([^"'\s]+)["']?/gi,
      /\bdb-instance-class:\s*["']?([^"'\s]+)["']?/gi,
    ];

    const filters: Record<string, any> = {};
    for (const pattern of filterPatterns) {
      const matches = request.matchAll(pattern);
      for (const match of matches) {
        const [, key, value] = match;
        filters[key.toLowerCase()] = value;
      }
    }
    entities.filters = filters;

    return entities;
  }

  /**
   * Match request against known intent patterns
   */
  private matchPattern(request: string): (typeof INTENT_PATTERNS)[0] | null {
    for (const pattern of INTENT_PATTERNS) {
      for (const regex of pattern.patterns) {
        if (regex.test(request)) {
          return pattern;
        }
      }
    }
    return null;
  }

  /**
   * Enhance entity extraction for complex requests
   */
  private enhanceEntities(request: string, entities: IntentEntities): void {
    // Look for specific instance types, database classes, etc.
    const instanceTypeMatch = request.match(
      /\b(t3\.micro|t3\.small|t3\.medium|m5\.large|c5\.xlarge)\b/i,
    );
    if (instanceTypeMatch && !entities.parameters) {
      entities.parameters = { instanceType: instanceTypeMatch[1] };
    }

    // Look for memory specifications
    const memoryMatch = request.match(/(\d+)\s*(mb|gb)/i);
    if (memoryMatch && !entities.parameters) {
      entities.parameters = {
        memory:
          parseInt(memoryMatch[1]) *
          (memoryMatch[2].toLowerCase() === 'gb' ? 1024 : 1),
      };
    }

    // Look for timeout specifications
    const timeoutMatch = request.match(/(\d+)\s*(second|minute|hour)/i);
    if (timeoutMatch && !entities.parameters) {
      const [, value, unit] = timeoutMatch;
      const multiplier =
        unit.toLowerCase() === 'minute'
          ? 60
          : unit.toLowerCase() === 'hour'
            ? 3600
            : 1;
      entities.parameters = {
        timeout: parseInt(value) * multiplier,
      };
    }
  }

  /**
   * Normalize service names
   */
  private normalizeService(service: string): string {
    const serviceMap: Record<string, string> = {
      ec2: 'ec2',
      'elastic compute cloud': 'ec2',
      rds: 'rds',
      'relational database service': 'rds',
      s3: 's3',
      'simple storage service': 's3',
      lambda: 'lambda',
      cloudwatch: 'cloudwatch',
      dynamodb: 'dynamodb',
      ecs: 'ecs',
    };

    return serviceMap[service.toLowerCase()] || service.toLowerCase();
  }

  /**
   * Normalize region names
   */
  private normalizeRegion(region: string): string {
    const regionMap: Record<string, string> = {
      virginia: 'us-east-1',
      oregon: 'us-west-2',
      ireland: 'eu-west-1',
      singapore: 'ap-southeast-1',
      tokyo: 'ap-northeast-1',
    };

    return regionMap[region.toLowerCase()] || region.toLowerCase();
  }
}
