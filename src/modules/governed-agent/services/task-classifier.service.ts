import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../../services/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { TaskClassification } from '../interfaces/governed-agent.interfaces';

@Injectable()
export class TaskClassifierService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
  ) {}

  /**
   * Check if classification can be skipped for obvious simple queries
   */
  shouldSkipClassification(userRequest: string): boolean {
    const lowerRequest = userRequest.toLowerCase().trim();

    // Very simple commands that are obviously direct execution
    const directExecutionPatterns = [
      /^list (my )?github repo/i,
      /^show (my )?github repo/i,
      /^list (my )?google drive files/i,
      /^show (my )?google files/i,
      /^list (my )?vercel projects/i,
      /^show (my )?vercel projects/i,
      /^what (is|are) (my )?aws/i,
      /^help$/i,
      /^status$/i,
    ];

    return directExecutionPatterns.some((pattern) =>
      pattern.test(lowerRequest),
    );
  }

  /**
   * Get a fast classification for obvious simple queries without LLM call
   */
  getFastClassification(userRequest: string): TaskClassification {
    return {
      type: 'simple_query',
      integrations: this.detectIntegrations(userRequest),
      complexity: 'low',
      riskLevel: 'low',
      route: 'DIRECT_EXECUTION',
      reasoning: 'Obvious simple query detected',
    };
  }

  /**
   * Classify a user request to determine execution strategy
   */
  async classifyTask(
    userRequest: string,
    userId: string,
  ): Promise<TaskClassification> {
    const startTime = Date.now();

    try {
      this.logger.log('Classifying task request', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        userId,
        userRequest: userRequest.substring(0, 100),
      });

      // Use Nova Lite for fast classification (< 2 seconds)
      const prompt = `Classify this user request for an AI agent execution platform:

User Request: "${userRequest}"

Respond with JSON only:
{
  "type": "simple_query|complex_query|cross_integration|coding|research|data_transformation",
  "complexity": "low|medium|high",
  "riskLevel": "low|medium|high",
  "integrations": ["github", "vercel", "mongodb", "google", "jira", "aws"],
  "route": "DIRECT_EXECUTION|GOVERNED_WORKFLOW",
  "reasoning": "brief explanation"
}

Type definitions:
- simple_query: Basic info requests, status checks, single operations
- complex_query: Multi-step queries, aggregations, complex searches
- cross_integration: Work across multiple services (GitHub + Vercel, etc.)
- coding: Code generation, deployment, development tasks
- research: Information gathering, analysis, recommendations
- data_transformation: ETL, data migration, format conversion

Complexity: based on steps required, integrations needed, technical difficulty
Risk: based on potential impact, cost, data modification, security concerns
Route: Use GOVERNED_WORKFLOW for coding, deployment, builds, integrations, research, or any multi-step work. Use DIRECT_EXECUTION only for trivial read-only queries like "list repos", "show status", "help". When in doubt, use GOVERNED_WORKFLOW.`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false },
      );
      const response = result.response;

      // Parse AI response
      let classification: TaskClassification;
      try {
        const cleaned = response
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        classification = JSON.parse(cleaned) as TaskClassification;
      } catch (parseError) {
        this.logger.warn('Failed to parse AI classification, using fallback', {
          component: 'TaskClassifierService',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          response: response.substring(0, 200),
        });
        classification = this.getFallbackClassification(userRequest);
      }

      // Validate and sanitize classification
      classification = this.sanitizeClassification(classification, userRequest);

      const classificationTime = Date.now() - startTime;

      this.logger.log('Task classified successfully', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        type: classification.type,
        complexity: classification.complexity,
        riskLevel: classification.riskLevel,
        integrations: classification.integrations,
        route: classification.route,
        classificationTime,
      });

      return classification;
    } catch (error) {
      this.logger.error('Task classification failed, using fallback', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        userId,
        error: error instanceof Error ? error.message : String(error),
      });

      return this.getFallbackClassification(userRequest);
    }
  }

  /**
   * Get fallback classification for error cases
   */
  private getFallbackClassification(userRequest: string): TaskClassification {
    const lowerRequest = userRequest.toLowerCase();

    // Simple queries
    if (
      lowerRequest.includes('list') ||
      lowerRequest.includes('get') ||
      lowerRequest.includes('show') ||
      lowerRequest.includes('status')
    ) {
      return {
        type: 'simple_query',
        complexity: 'low',
        riskLevel: 'low',
        integrations: [],
        route: 'DIRECT_EXECUTION',
        reasoning: 'Simple read-only query',
      };
    }

    // Coding tasks
    if (
      lowerRequest.includes('build') ||
      lowerRequest.includes('create') ||
      lowerRequest.includes('deploy') ||
      lowerRequest.includes('code')
    ) {
      return {
        type: 'coding',
        complexity: 'high',
        riskLevel: 'medium',
        integrations: ['github', 'vercel'],
        route: 'GOVERNED_WORKFLOW',
        reasoning: 'Code generation and deployment task',
      };
    }

    // Cross-integration tasks
    if (
      lowerRequest.includes('integrate') ||
      lowerRequest.includes('sync') ||
      (lowerRequest.includes('from') && lowerRequest.includes('to'))
    ) {
      return {
        type: 'cross_integration',
        complexity: 'medium',
        riskLevel: 'medium',
        integrations: ['github', 'mongodb'],
        route: 'GOVERNED_WORKFLOW',
        reasoning: 'Data integration across services',
      };
    }

    // Default: use governed workflow for unknown/ambiguous requests
    return {
      type: 'complex_query',
      complexity: 'medium',
      riskLevel: 'low',
      integrations: ['mongodb'],
      route: 'GOVERNED_WORKFLOW',
      reasoning: 'Defaulting to governed workflow for full scope/plan flow',
    };
  }

  /**
   * Validate that classification makes sense
   */
  validateClassification(classification: TaskClassification): boolean {
    // Coding tasks should have high complexity
    if (
      classification.type === 'coding' &&
      classification.complexity === 'low'
    ) {
      return false;
    }

    // Simple queries should not have high risk
    if (
      classification.type === 'simple_query' &&
      ['medium', 'high'].includes(classification.riskLevel)
    ) {
      return false;
    }

    // Cross-integration should have at least 2 integrations
    if (
      classification.type === 'cross_integration' &&
      classification.integrations.length < 2
    ) {
      return false;
    }

    // High risk should require governed workflow
    if (
      classification.riskLevel === 'high' &&
      classification.route === 'DIRECT_EXECUTION'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Validate and sanitize classification results (internal method)
   */
  private sanitizeClassification(
    classification: any,
    userRequest: string,
  ): TaskClassification {
    // Ensure required fields exist with defaults
    const validTypes = [
      'simple_query',
      'complex_query',
      'cross_integration',
      'coding',
      'research',
      'data_transformation',
    ];
    const validComplexities = ['low', 'medium', 'high'];
    const validRiskLevels = ['low', 'medium', 'high'];
    const validRoutes = ['DIRECT_EXECUTION', 'GOVERNED_WORKFLOW'];

    const result: TaskClassification = {
      type: validTypes.includes(classification.type)
        ? classification.type
        : 'complex_query',
      complexity: validComplexities.includes(classification.complexity)
        ? classification.complexity
        : 'medium',
      riskLevel: validRiskLevels.includes(classification.riskLevel)
        ? classification.riskLevel
        : 'low',
      integrations: Array.isArray(classification.integrations)
        ? classification.integrations.filter((i: any) => typeof i === 'string')
        : [],
      route: validRoutes.includes(classification.route)
        ? classification.route
        : 'GOVERNED_WORKFLOW',
      reasoning:
        typeof classification.reasoning === 'string'
          ? classification.reasoning
          : 'Classification based on request analysis',
    };

    // Auto-adjust route: ensure full SCOPE→CLARIFY→PLAN→BUILD flow for non-trivial tasks
    const governedTypes = [
      'coding',
      'cross_integration',
      'research',
      'data_transformation',
    ];
    if (
      governedTypes.includes(result.type) &&
      result.route === 'DIRECT_EXECUTION'
    ) {
      result.route = 'GOVERNED_WORKFLOW';
      result.reasoning += ` (${result.type} requires governed workflow)`;
    }
    if (result.riskLevel === 'high' && result.route === 'DIRECT_EXECUTION') {
      result.route = 'GOVERNED_WORKFLOW';
      result.reasoning += ' (upgraded to governed workflow due to high risk)';
    }
    // Only allow DIRECT_EXECUTION for simple_query with low risk
    if (
      result.route === 'DIRECT_EXECUTION' &&
      (result.type !== 'simple_query' || result.riskLevel !== 'low')
    ) {
      result.route = 'GOVERNED_WORKFLOW';
      result.reasoning +=
        ' (direct execution reserved for trivial read-only queries)';
    }

    // Auto-detect integrations from user request
    const detectedIntegrations = this.detectIntegrations(userRequest);
    if (detectedIntegrations.length > 0 && result.integrations.length === 0) {
      result.integrations = detectedIntegrations;
    }

    return result;
  }

  /**
   * Detect integrations mentioned in user request
   */
  private detectIntegrations(userRequest: string): string[] {
    const lowerRequest = userRequest.toLowerCase();
    const integrations: string[] = [];

    const integrationKeywords = {
      github: ['github', 'repo', 'repository', 'commit', 'pull request', 'pr'],
      vercel: ['vercel', 'deploy', 'deployment', 'vercel.app'],
      mongodb: ['mongo', 'mongodb', 'database', 'collection', 'document'],
      google: ['google', 'gmail', 'sheets', 'docs', 'drive'],
      jira: ['jira', 'ticket', 'issue', 'atlassian'],
      aws: ['aws', 's3', 'lambda', 'ec2', 'cloudformation'],
    };

    for (const [integration, keywords] of Object.entries(integrationKeywords)) {
      if (keywords.some((keyword) => lowerRequest.includes(keyword))) {
        integrations.push(integration);
      }
    }

    return integrations;
  }
}
