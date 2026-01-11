import { BedrockService } from './tracedBedrock.service';
import { loggingService } from './logging.service';

export type TaskType = 
  | 'simple_query' 
  | 'complex_query' 
  | 'cross_integration' 
  | 'coding' 
  | 'research' 
  | 'data_transformation';

export type TaskComplexity = 'low' | 'medium' | 'high';
export type TaskRiskLevel = 'none' | 'low' | 'medium' | 'high';
export type TaskRoute = 'DIRECT_EXECUTION' | 'GOVERNED_WORKFLOW';

export interface TaskClassification {
  type: TaskType;
  integrations: string[];
  complexity: TaskComplexity;
  riskLevel: TaskRiskLevel;
  requiresPlanning: boolean;
  route: TaskRoute;
  reasoning: string;
  estimatedDuration?: number; // seconds
}

export class TaskClassifierService {
  /**
   * Classify a user request to determine execution strategy
   * Uses fast LLM (Nova Lite) for quick classification (< 2 seconds)
   */
  static async classifyTask(userRequest: string, userId: string): Promise<TaskClassification> {
    const startTime = Date.now();
    
    try {
      loggingService.info('🔍 Classifying task', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        userId,
        requestLength: userRequest.length
      });

      // Use Nova Lite for fast, cost-effective classification
      const prompt = `You are a task classifier for an autonomous agent system. Analyze this user request and classify it.

User Request: "${userRequest}"

Classify the task by determining:

1. TYPE - What kind of task is this?
   - simple_query: Single integration, read-only, straightforward (e.g., "list my repos", "show files")
   - complex_query: Multi-step query or analysis needed (e.g., "find users who haven't logged in")
   - cross_integration: Involves 2+ integrations (e.g., "export MongoDB to Google Sheets")
   - coding: Code generation and/or deployment (e.g., "build an app", "deploy to AWS")
   - research: Requires web search/research (e.g., "best practices for...", "how to...")
   - data_transformation: Analyze data and perform actions (e.g., "analyze costs, create tickets")

2. INTEGRATIONS - Which integrations are needed? Options: [github, google, mongodb, aws, jira, vercel, none]

3. COMPLEXITY - How complex is this task?
   - low: Single step, straightforward
   - medium: Multiple steps or requires analysis
   - high: Complex multi-step workflow

4. RISK LEVEL - What's the risk of this operation?
   - none: Read-only, no side effects
   - low: Minor changes or external API calls
   - medium: Creates files, tickets, or notifications
   - high: Provisions cloud resources, costs money, or affects production

5. REQUIRES PLANNING - Should this go through plan mode?
   - false: Simple tasks that can be executed directly
   - true: Complex tasks that need research, approval gates, or multi-step execution

Output ONLY valid JSON (no markdown, no explanations):
{
  "type": "simple_query|complex_query|cross_integration|coding|research|data_transformation",
  "integrations": ["integration1", "integration2"],
  "complexity": "low|medium|high",
  "riskLevel": "none|low|medium|high",
  "requiresPlanning": true|false,
  "reasoning": "Brief explanation of classification"
}`;

      const response = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false }
      );

      // Parse the response
      let classification: Omit<TaskClassification, 'route' | 'estimatedDuration'>;
      
      try {
        // Remove any markdown code blocks if present
        const cleanedResponse = response.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        classification = JSON.parse(cleanedResponse);
      } catch (parseError) {
        loggingService.error('Failed to parse classification response', {
          component: 'TaskClassifierService',
          operation: 'classifyTask',
          error: parseError instanceof Error ? parseError.message : String(parseError),
          response
        });
        
        // Fallback to safe classification
        classification = {
          type: 'complex_query',
          integrations: [],
          complexity: 'medium',
          riskLevel: 'low',
          requiresPlanning: true,
          reasoning: 'Failed to parse classification, defaulting to safe mode'
        };
      }

      // Determine routing
      const route: TaskRoute = classification.requiresPlanning ? 'GOVERNED_WORKFLOW' : 'DIRECT_EXECUTION';

      // Estimate duration based on complexity and type
      const estimatedDuration = this.estimateDuration(classification);

      const finalClassification: TaskClassification = {
        ...classification,
        route,
        estimatedDuration
      };

      const classificationTime = Date.now() - startTime;

      loggingService.info('✅ Task classified', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        userId,
        classification: finalClassification,
        classificationTime
      });

      return finalClassification;

    } catch (error) {
      loggingService.error('Task classification failed', {
        component: 'TaskClassifierService',
        operation: 'classifyTask',
        userId,
        error: error instanceof Error ? error.message : String(error)
      });

      // Fallback to safe conservative classification
      return {
        type: 'complex_query',
        integrations: [],
        complexity: 'medium',
        riskLevel: 'low',
        requiresPlanning: true,
        route: 'GOVERNED_WORKFLOW',
        reasoning: 'Classification failed, using conservative defaults for safety',
        estimatedDuration: 30
      };
    }
  }

  /**
   * Estimate task duration based on classification
   */
  private static estimateDuration(classification: Omit<TaskClassification, 'route' | 'estimatedDuration'>): number {
    // Base duration by type
    const typeDurations: Record<TaskType, number> = {
      simple_query: 3,
      complex_query: 15,
      cross_integration: 30,
      coding: 180, // 3 minutes
      research: 20,
      data_transformation: 45
    };

    let duration = typeDurations[classification.type] || 30;

    // Adjust for complexity
    if (classification.complexity === 'high') {
      duration *= 2;
    } else if (classification.complexity === 'low') {
      duration *= 0.5;
    }

    // Add time for each integration
    duration += classification.integrations.length * 5;

    return Math.round(duration);
  }

  /**
   * Check if a task should skip directly to execution without classification
   * Used for very obvious simple queries to save on LLM calls
   */
  static shouldSkipClassification(userRequest: string): boolean {
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
      /^status$/i
    ];

    return directExecutionPatterns.some(pattern => pattern.test(lowerRequest));
  }

  /**
   * Get a fast classification for obvious simple queries without LLM call
   */
  static getFastClassification(userRequest: string): TaskClassification {
    return {
      type: 'simple_query',
      integrations: this.detectIntegrationsFromKeywords(userRequest),
      complexity: 'low',
      riskLevel: 'none',
      requiresPlanning: false,
      route: 'DIRECT_EXECUTION',
      reasoning: 'Obvious simple query detected',
      estimatedDuration: 3
    };
  }

  /**
   * Detect integrations from keywords in request
   */
  private static detectIntegrationsFromKeywords(request: string): string[] {
    const lowerRequest = request.toLowerCase();
    const integrations: string[] = [];

    if (lowerRequest.includes('github') || lowerRequest.includes('repo')) {
      integrations.push('github');
    }
    if (lowerRequest.includes('google') || lowerRequest.includes('drive') || lowerRequest.includes('sheet')) {
      integrations.push('google');
    }
    if (lowerRequest.includes('mongodb') || lowerRequest.includes('database') || lowerRequest.includes('collection')) {
      integrations.push('mongodb');
    }
    if (lowerRequest.includes('aws') || lowerRequest.includes('s3') || lowerRequest.includes('ec2')) {
      integrations.push('aws');
    }
    if (lowerRequest.includes('jira') || lowerRequest.includes('ticket') || lowerRequest.includes('issue')) {
      integrations.push('jira');
    }
    if (lowerRequest.includes('vercel') || lowerRequest.includes('deploy')) {
      integrations.push('vercel');
    }

    return integrations;
  }

  /**
   * Validate that classification makes sense
   */
  static validateClassification(classification: TaskClassification): boolean {
    // Coding tasks should have high complexity
    if (classification.type === 'coding' && classification.complexity === 'low') {
      return false;
    }

    // Simple queries should not have high risk
    if (classification.type === 'simple_query' && ['medium', 'high'].includes(classification.riskLevel)) {
      return false;
    }

    // Cross-integration should have at least 2 integrations
    if (classification.type === 'cross_integration' && classification.integrations.length < 2) {
      return false;
    }

    // High risk should require planning
    if (classification.riskLevel === 'high' && !classification.requiresPlanning) {
      return false;
    }

    return true;
  }
}
