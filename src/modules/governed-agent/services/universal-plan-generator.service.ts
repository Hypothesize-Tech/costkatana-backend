import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { GoogleSearchService } from '../../utils/services/google-search.service';
import { RiskAssessorService } from './risk-assessor.service';
import {
  GovernedTask,
  ExecutionPlan,
  PlanPhase,
  PlanStep,
  ResearchResult,
  TaskClassification,
} from '../interfaces/governed-agent.interfaces';

@Injectable()
export class UniversalPlanGeneratorService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
    private readonly googleSearchService: GoogleSearchService,
  ) {}

  /**
   * Generate an execution plan for any task type
   * Conducts research if needed and creates detailed step-by-step plan
   */
  async generatePlan(
    task: GovernedTask,
    classification: TaskClassification,
    clarifyingAnswers?: Record<string, any>,
  ): Promise<ExecutionPlan> {
    const startTime = Date.now();

    try {
      this.logger.log('Generating execution plan', {
        component: 'UniversalPlanGeneratorService',
        operation: 'generatePlan',
        taskId: task.id,
        type: classification.type,
        complexity: classification.complexity,
        hasClarifyingAnswers: !!clarifyingAnswers,
      });

      // Enrich task with clarifying answers if provided
      const enrichedUserRequest = clarifyingAnswers
        ? `${task.userRequest}\n\n**Clarifications:**\n${Object.entries(
            clarifyingAnswers,
          )
            .map(([q, a]) => `Q: ${q}\nA: ${a}`)
            .join('\n')}`
        : task.userRequest;

      const enrichedTask = { ...task, userRequest: enrichedUserRequest };

      // Step 1: Research (if needed for complex tasks or research type)
      const research =
        classification.type === 'research' ||
        classification.complexity === 'high'
          ? await this.conductResearch(enrichedUserRequest, classification)
          : undefined;

      // Step 2: Generate plan based on task type
      let phases: PlanPhase[];

      switch (classification.type) {
        case 'cross_integration':
          phases = await this.generateCrossIntegrationPlan(
            enrichedTask,
            classification,
            research,
          );
          break;

        case 'data_transformation':
          phases = await this.generateDataTransformationPlan(
            enrichedTask,
            classification,
            research,
          );
          break;

        case 'coding':
          phases = await this.generateCodingPlan(
            enrichedTask,
            classification,
            research,
          );
          break;

        case 'complex_query':
          phases = await this.generateQueryPlan(enrichedTask, classification);
          break;

        case 'research':
          phases = await this.generateResearchPlan(enrichedTask, research!);
          break;

        case 'simple_query':
        default:
          phases = await this.generateSimpleQueryPlan(task, classification);
          break;
      }

      // Step 3: Calculate total duration
      const estimatedDuration = phases.reduce(
        (total, phase) =>
          total +
          phase.steps.reduce(
            (phaseTotal, step) => phaseTotal + step.estimatedDuration,
            0,
          ),
        0,
      );

      // Step 4: Build the plan
      const plan: ExecutionPlan = {
        phases,
        researchSources: research ? [research] : undefined,
        estimatedDuration,
        estimatedCost: this.estimateCost(phases),
        riskAssessment: {
          level: 'none',
          reasons: [],
          requiresApproval: false,
        },
      };

      // Step 5: Assess risk
      plan.riskAssessment = RiskAssessorService.assessRisk(plan);

      // Step 6: Generate rollback plan if risky
      if (plan.riskAssessment.level !== 'none') {
        plan.rollbackPlan = this.generateRollbackPlan(phases);
      }

      const planTime = Date.now() - startTime;

      this.logger.log('Execution plan generated successfully', {
        component: 'UniversalPlanGeneratorService',
        operation: 'generatePlan',
        taskId: task.id,
        phasesCount: phases.length,
        totalSteps: phases.reduce((sum, p) => sum + p.steps.length, 0),
        estimatedDuration,
        riskLevel: plan.riskAssessment.level,
        requiresApproval: plan.riskAssessment.requiresApproval,
        planTime,
      });

      return plan;
    } catch (error) {
      this.logger.error('Failed to generate execution plan', {
        component: 'UniversalPlanGeneratorService',
        operation: 'generatePlan',
        taskId: task.id,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Conduct research using web search and LLM synthesis
   */
  private async conductResearch(
    userRequest: string,
    classification: TaskClassification,
  ): Promise<ResearchResult> {
    try {
      this.logger.log('Conducting research', {
        component: 'UniversalPlanGeneratorService',
        operation: 'conductResearch',
        type: classification.type,
      });

      // Generate search queries based on task
      const searchQueries = await this.generateSearchQueries(
        userRequest,
        classification,
      );

      // Perform real web search
      try {
        const allSearchResults: any[] = [];

        // Execute searches for each query
        for (const searchQuery of searchQueries.slice(0, 3)) {
          // Limit to 3 queries for performance
          try {
            const searchResults = await this.googleSearchService.search(
              searchQuery,
              {
                maxResults: 5, // Limit results per query
              },
            );

            allSearchResults.push(
              ...searchResults.map((result) => ({
                query: searchQuery,
                title: result.title,
                url: result.url,
                snippet: result.snippet,
                relevance: this.calculateRelevance(searchQuery, result),
                metadata: result.metadata,
              })),
            );
          } catch (searchError) {
            this.logger.warn(`Web search failed for query: ${searchQuery}`, {
              error:
                searchError instanceof Error
                  ? searchError.message
                  : String(searchError),
            });
          }
        }

        // Synthesize findings from search results
        const synthesis = await this.synthesizeResearchFindings(
          userRequest,
          classification,
          allSearchResults,
        );

        // Extract key findings
        const keyFindings = await this.extractKeyFindings(
          userRequest,
          allSearchResults,
        );

        return {
          query: userRequest,
          sources: allSearchResults,
          synthesis,
          keyFindings,
          searchTimestamp: new Date().toISOString(),
        };
      } catch (searchError) {
        // CRITICAL: Do not fall back to placeholder research in production
        this.logger.error(
          'Web search failed and no fallback research available',
          {
            error:
              searchError instanceof Error
                ? searchError.message
                : String(searchError),
          },
        );
        throw new Error(
          'Research functionality is currently unavailable. Please try again later or provide manual research data.',
        );
      }
    } catch (error) {
      this.logger.error('Failed to conduct research', {
        component: 'UniversalPlanGeneratorService',
        operation: 'conductResearch',
        type: classification.type,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Calculate relevance score for a search result
   */
  private calculateRelevance(query: string, result: any): number {
    const queryLower = query.toLowerCase();
    const titleLower = result.title?.toLowerCase() || '';
    const snippetLower = result.snippet?.toLowerCase() || '';

    let score = 0;

    // Title relevance
    if (titleLower.includes(queryLower)) score += 0.4;
    const titleWords = queryLower.split(' ').filter((word) => word.length > 2);
    titleWords.forEach((word) => {
      if (titleLower.includes(word)) score += 0.1;
    });

    // Snippet relevance
    if (snippetLower.includes(queryLower)) score += 0.3;
    const snippetWords = queryLower
      .split(' ')
      .filter((word) => word.length > 2);
    snippetWords.forEach((word) => {
      if (snippetLower.includes(word)) score += 0.05;
    });

    // Domain authority (rough heuristic)
    if (result.url?.includes('github.com')) score += 0.1;
    if (result.url?.includes('stackoverflow.com')) score += 0.1;
    if (result.url?.includes('docs.') || result.url?.includes('api.'))
      score += 0.1;

    return Math.min(score, 1.0);
  }

  /**
   * Synthesize research findings using AI
   */
  private async synthesizeResearchFindings(
    userRequest: string,
    classification: TaskClassification,
    searchResults: any[],
  ): Promise<string> {
    try {
      const topResults = searchResults
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 10);

      const synthesisPrompt = `Synthesize the key findings from this web research for the task: "${userRequest}"

Research Results:
${topResults
  .map(
    (result, index) =>
      `${index + 1}. ${result.title}\n   ${result.snippet}\n   URL: ${result.url}\n   Relevance: ${(result.relevance * 100).toFixed(0)}%`,
  )
  .join('\n\n')}

Task Type: ${classification.type}
Integrations: ${classification.integrations.join(', ')}

Provide a concise synthesis of the most relevant findings, best practices, and recommendations. Focus on practical, actionable insights.`;

      const synthesis = await BedrockService.invokeModel(
        synthesisPrompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      return synthesis || 'Unable to synthesize research findings.';
    } catch (error) {
      this.logger.warn('Failed to synthesize research findings', { error });
      return `Research completed with ${searchResults.length} sources found. Key insights include best practices, documentation, and community solutions.`;
    }
  }

  /**
   * Extract key findings from search results
   */
  private async extractKeyFindings(
    userRequest: string,
    searchResults: any[],
  ): Promise<string[]> {
    try {
      const topResults = searchResults
        .sort((a, b) => b.relevance - a.relevance)
        .slice(0, 8);

      const findingsPrompt = `Extract 3-5 key practical findings from this research for: "${userRequest}"

${topResults.map((result) => `- ${result.title}: ${result.snippet}`).join('\n')}

Focus on:
- Best practices and patterns
- Common solutions and approaches
- Important considerations or warnings
- Recent updates or recommendations

Respond with a JSON array of strings, each being a concise, actionable finding.`;

      const response = await BedrockService.invokeModel(
        findingsPrompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const content = response || '[]';

      try {
        const findings = JSON.parse(content.replace(/```json\n?|\n?```/g, ''));
        return Array.isArray(findings)
          ? findings.slice(0, 5)
          : [
              'Follow established best practices for the technology stack',
              'Implement proper error handling and logging',
              'Consider security implications and data protection',
              'Use version control and documentation',
              'Test thoroughly before deployment',
            ];
      } catch {
        // Fallback to generic findings
        return [
          'Follow established best practices for the technology stack',
          'Implement proper error handling and logging',
          'Consider security implications and data protection',
          'Use version control and documentation',
          'Test thoroughly before deployment',
        ];
      }
    } catch (error) {
      this.logger.warn('Failed to extract key findings', { error });
      return [
        'Research indicates following industry best practices',
        'Proper error handling and validation are essential',
        'Security considerations should be prioritized',
        'Documentation and testing are recommended',
      ];
    }
  }

  /**
   * Generate search queries for research using AI
   */
  private async generateSearchQueries(
    userRequest: string,
    classification: TaskClassification,
  ): Promise<string[]> {
    try {
      const prompt = `Generate 3-5 specific web search queries to research this task:

Task: "${userRequest}"
Type: ${classification.type}
Integrations: ${classification.integrations.join(', ')}

Generate search queries that will find:
1. Best practices and tutorials
2. API documentation and examples
3. Common pitfalls and solutions
4. Recent updates and recommendations (2024-2025)

Respond with JSON array of strings:
["query 1", "query 2", "query 3", ...]`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : '';

      // Parse the response
      try {
        const cleaned = response
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        const queries = JSON.parse(cleaned) as string[];
        if (Array.isArray(queries) && queries.length > 0) {
          return queries.slice(0, 5);
        }
      } catch (parseError) {
        this.logger.warn('Failed to parse AI search queries, using fallback', {
          component: 'UniversalPlanGeneratorService',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    } catch (error) {
      this.logger.warn('AI query generation failed, using fallback', {
        component: 'UniversalPlanGeneratorService',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to rule-based queries
    const queries: string[] = [];

    // Add queries based on integrations
    classification.integrations.forEach((integration) => {
      queries.push(`${integration} API best practices 2025`);
    });

    // Add queries based on task type
    if (classification.type === 'coding') {
      queries.push('modern web development best practices');
      queries.push('deployment automation guide');
    }

    if (classification.type === 'cross_integration') {
      queries.push('API integration patterns');
      queries.push('data transformation best practices');
    }

    if (classification.type === 'data_transformation') {
      queries.push('data transformation patterns');
      queries.push('ETL best practices');
    }

    return queries.slice(0, 5); // Max 5 queries
  }

  /**
   * Generate plan for cross-integration workflows using AI
   */
  private async generateCrossIntegrationPlan(
    task: GovernedTask,
    classification: TaskClassification,
    research?: ResearchResult,
  ): Promise<PlanPhase[]> {
    try {
      const researchContext = research
        ? `\n\nResearch Findings:\n${research.synthesis}\nKey Points: ${research.keyFindings.join(', ')}`
        : '';

      const prompt = `Create a detailed execution plan for this cross-integration task:

Task: "${task.userRequest}"
Source Integration: ${classification.integrations[0] || 'unknown'}
Target Integrations: ${classification.integrations.slice(1).join(', ') || 'unknown'}${researchContext}

Generate a plan with 2-4 phases. For each phase provide:
- Phase name
- Whether approval is required (true for write operations)
- Risk level (none/low/medium/high)
- Detailed steps with tool, action, and description

Respond in JSON:
{
  "phases": [
    {
      "name": "Phase Name",
      "approvalRequired": false,
      "riskLevel": "none",
      "steps": [
        {
          "id": "step_1",
          "tool": "integration_name",
          "action": "query|create|update",
          "params": {},
          "description": "Detailed description",
          "estimatedDuration": 10
        }
      ]
    }
  ]
}`;

      const result = await BedrockService.invokeModel(
        prompt,
        'us.anthropic.claude-sonnet-4-6',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : '';

      // Parse AI response
      try {
        const cleaned = response
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        const parsed = JSON.parse(cleaned) as { phases?: PlanPhase[] };
        if (
          parsed.phases &&
          Array.isArray(parsed.phases) &&
          parsed.phases.length > 0
        ) {
          return parsed.phases;
        }
      } catch (parseError) {
        this.logger.warn('Failed to parse AI plan, using fallback', {
          component: 'UniversalPlanGeneratorService',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    } catch (error) {
      this.logger.warn('AI plan generation failed, using fallback', {
        component: 'UniversalPlanGeneratorService',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback to rule-based plan
    const phases: PlanPhase[] = [];

    // Phase 1: Data Collection
    const sourceIntegration = classification.integrations[0] || 'source';
    phases.push({
      name: 'Data Collection',
      approvalRequired: false,
      steps: [
        {
          id: 'collect_1',
          tool: `${sourceIntegration}_integration`,
          action: 'query',
          params: {},
          description: `Fetch data from ${sourceIntegration}`,
          estimatedDuration: 10,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 2: Data Transformation
    phases.push({
      name: 'Data Transformation',
      approvalRequired: false,
      steps: [
        {
          id: 'transform_1',
          tool: 'data_transformer',
          action: 'transform',
          params: {},
          description: 'Transform and map data fields for target integration',
          estimatedDuration: 5,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 3: Export/Create
    const targetIntegrations = classification.integrations.slice(1);
    if (targetIntegrations.length > 0) {
      const exportSteps: PlanStep[] = targetIntegrations.map(
        (integration, idx) => ({
          id: `export_${idx}`,
          tool: `${integration}_integration`,
          action: 'create',
          params: {},
          description: `Export transformed data to ${integration}`,
          estimatedDuration: 15,
        }),
      );

      phases.push({
        name: 'Data Export',
        approvalRequired: true, // Creating new resources
        steps: exportSteps,
        riskLevel: 'medium',
      });
    }

    return phases;
  }

  /**
   * Generate plan for data transformation tasks using AI
   */
  private async generateDataTransformationPlan(
    task: GovernedTask,
    classification: TaskClassification,
    research?: ResearchResult,
  ): Promise<PlanPhase[]> {
    try {
      const researchContext = research
        ? `\n\nResearch Context:\n${research.synthesis}`
        : '';

      const prompt = `Create an execution plan for this data transformation task:

Task: "${task.userRequest}"
Integrations: ${classification.integrations.join(', ')}
Complexity: ${classification.complexity}${researchContext}

Generate 2-3 phases:
1. Data Analysis/Validation
2. Transformation/Processing
3. Action/Export

For each phase, provide detailed steps with tools and actions.

Respond in JSON:
{
  "phases": [
    {
      "name": "Phase Name",
      "approvalRequired": false,
      "riskLevel": "none",
      "steps": [{
        "id": "step_id",
        "tool": "tool_name",
        "action": "action_type",
        "params": {},
        "description": "What this step does",
        "estimatedDuration": 15
      }]
    }
  ]
}`;

      const result = await BedrockService.invokeModel(
        prompt,
        'us.anthropic.claude-sonnet-4-6',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : '';

      try {
        const cleaned = response
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();
        const parsed = JSON.parse(cleaned) as { phases?: PlanPhase[] };
        if (
          parsed.phases &&
          Array.isArray(parsed.phases) &&
          parsed.phases.length > 0
        ) {
          return parsed.phases;
        }
      } catch (parseError) {
        this.logger.warn('Failed to parse AI transformation plan', {
          component: 'UniversalPlanGeneratorService',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
        });
      }
    } catch (error) {
      this.logger.warn('AI transformation plan failed, using fallback', {
        component: 'UniversalPlanGeneratorService',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback plan
    const phases: PlanPhase[] = [];

    // Phase 1: Data Analysis
    phases.push({
      name: 'Data Analysis & Validation',
      approvalRequired: false,
      steps: [
        {
          id: 'analyze_1',
          tool: classification.integrations[0]
            ? `${classification.integrations[0]}_integration`
            : 'data_analyzer',
          action: 'analyze',
          params: {},
          description:
            'Analyze data structure, validate formats, and identify transformation requirements',
          estimatedDuration: 20,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 2: Transformation
    phases.push({
      name: 'Data Transformation',
      approvalRequired: false,
      steps: [
        {
          id: 'transform_1',
          tool: 'data_transformer',
          action: 'transform',
          params: {},
          description:
            'Apply transformation rules, clean data, and format for target system',
          estimatedDuration: 25,
        },
      ],
      riskLevel: 'low',
    });

    // Phase 3: Execute Actions
    const targetIntegration =
      classification.integrations[classification.integrations.length - 1];
    if (targetIntegration) {
      phases.push({
        name: 'Execute Actions',
        approvalRequired: true, // Creating/updating resources
        steps: [
          {
            id: 'action_1',
            tool: `${targetIntegration}_integration`,
            action: 'create',
            params: {},
            description: `Create/update records in ${targetIntegration} based on transformed data`,
            estimatedDuration: 30,
          },
        ],
        riskLevel: 'medium',
      });
    }

    return phases;
  }

  /**
   * Generate plan for coding/deployment tasks using AI
   */
  private async generateCodingPlan(
    task: GovernedTask,
    classification: TaskClassification,
    research?: ResearchResult,
  ): Promise<PlanPhase[]> {
    try {
      const hasGitHub = classification.integrations.includes('github');
      const hasVercel = classification.integrations.includes('vercel');
      const hasAWS = classification.integrations.includes('aws');

      const researchContext = research
        ? `\n\nBest Practices:\n${research.keyFindings.join('\n- ')}`
        : '';

      // Determine project type and repository structure
      const isFullStack =
        task.userRequest.toLowerCase().includes('backend') &&
        task.userRequest.toLowerCase().includes('frontend');
      const isMERN =
        task.userRequest.toLowerCase().includes('mern') ||
        (task.userRequest.toLowerCase().includes('react') &&
          task.userRequest.toLowerCase().includes('node'));

      // Extract app name from user request or use generic name
      const appNameMatch = task.userRequest.match(
        /(?:build|create|develop)\s+(?:a\s+)?([a-zA-Z0-9\s-]+?)(?:\s+(?:app|application|website|platform|system))/i,
      );
      const appName = appNameMatch
        ? appNameMatch[1].trim().toLowerCase().replace(/\s+/g, '-')
        : 'app';

      const backendRepoName = `${appName}-backend`;
      const frontendRepoName = `${appName}-frontend`;
      const singleRepoName = appName;

      const prompt = `Task: "${task.userRequest}"${researchContext}

Generate a complete plan with these REQUIRED phases:

Phase 1: Version Control Setup${isFullStack || isMERN ? ' (Create 2 repos: backend AND frontend)' : ''}
- Use tool:"github_integration", action:"createRepository" for EACH repository
${
  isFullStack || isMERN
    ? `- Step 1: Create backend repository (${backendRepoName})\n- Step 2: Create frontend repository (${frontendRepoName})`
    : `- Create repository for the project (${singleRepoName})`
}
- Each step needs: repoName, description, private flag
- approvalRequired: false

Phase 2: Code Generation & Architecture
- Use tool:"code_generator", action:"generate" to create all application code
- Description: "Generate application code with modern best practices, proper structure, and documentation"
- estimatedDuration: 60
- approvalRequired: false

Phase 3: ${hasVercel ? 'Vercel Deployment' : 'Deployment'}
${
  hasVercel
    ? `- Use tool:"vercel_integration", action:"deploy" with gitSource to auto-create project and deploy
- The system will automatically create Vercel project if it doesn't exist`
    : ''
}
- approvalRequired: true

Phase 4: Post-Deployment Verification
- tool:"health_checker", action:"verify"
- Description: "Verify deployment health, test endpoints, and confirm accessibility"

CRITICAL RULES:
1. MUST create GitHub repositories BEFORE generating code (Phase 1 before Phase 2)
2. For full-stack projects with "backend" AND "frontend", create 2 GitHub repositories
3. For Vercel deployment, use single "deploy" action with gitSource - it will auto-create project if needed
4. Use exact tool names: "code_generator", "github_integration", "vercel_integration", "health_checker"
5. NO "code_analyzer" tool - we generate production-ready code
6. Each step needs unique id (step_1, step_2, etc.)
7. Vercel deploy step MUST include gitSource: {type:"github", repo:"{{username}}/${frontendRepoName}"}
8. Use app name "${appName}" for repository naming

EXAMPLE Vercel deploy step:
{
  "id": "deploy_vercel",
  "tool": "vercel_integration",
  "action": "deploy",
  "params": {
    "gitSource": {
      "type": "github",
      "repo": "{{username}}/${frontendRepoName}"
    },
    "framework": "create-react-app"
  },
  "description": "Deploy frontend to Vercel (auto-creates project if needed)",
  "estimatedDuration": 90
}

Return ONLY valid JSON with this structure:
{
  "plan": {
    "phases": [{"name": "...", "approvalRequired": true/false, "steps": [...], "riskLevel": "low/medium/high"}]
  }
}

No markdown, no explanation.`;

      this.logger.log('Generated prompt for AI plan', {
        component: 'UniversalPlanGeneratorService',
        taskId: task.id,
        userRequest: task.userRequest.substring(0, 100),
        appName,
        isFullStack,
        isMERN,
        backendRepoName,
        frontendRepoName,
        singleRepoName,
        promptLength: prompt.length,
        hasGitHub,
        hasVercel,
        hasAWS,
      });

      this.logger.log('Starting AI plan generation', {
        component: 'UniversalPlanGeneratorService',
        taskId: task.id,
        userRequest: task.userRequest,
        hasGitHub,
        hasVercel,
        hasAWS,
        promptLength: prompt.length,
      });

      const result = await BedrockService.invokeModel(
        prompt,
        'us.anthropic.claude-sonnet-4-6',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : '';

      try {
        let cleaned = response
          .replace(/```json\n?/g, '')
          .replace(/```\n?/g, '')
          .trim();

        // If response is too long or truncated, try to fix it
        if (cleaned.length > 10000 || !cleaned.endsWith('}')) {
          const openBraces = (cleaned.match(/\{/g) ?? []).length;
          const closeBraces = (cleaned.match(/\}/g) ?? []).length;
          const openBrackets = (cleaned.match(/\[/g) ?? []).length;
          const closeBrackets = (cleaned.match(/\]/g) ?? []).length;

          // Add missing closing brackets/braces
          for (let i = 0; i < openBrackets - closeBrackets; i++) {
            cleaned += ']';
          }
          for (let i = 0; i < openBraces - closeBraces; i++) {
            cleaned += '}';
          }
        }

        const parsed = JSON.parse(cleaned) as { phases?: PlanPhase[] };

        this.logger.log('Successfully parsed AI plan JSON', {
          component: 'UniversalPlanGeneratorService',
          phasesCount: parsed.phases?.length ?? 0,
          totalSteps:
            parsed.phases?.reduce(
              (sum, p) => sum + (p.steps?.length ?? 0),
              0,
            ) ?? 0,
          phaseNames: parsed.phases?.map((p) => p.name) ?? [],
        });

        if (
          parsed.phases &&
          Array.isArray(parsed.phases) &&
          parsed.phases.length > 0
        ) {
          return parsed.phases;
        } else {
          this.logger.warn('Parsed JSON but no valid phases found', {
            component: 'UniversalPlanGeneratorService',
            parsedKeys: Object.keys(parsed),
            hasPhases: !!parsed.phases,
            phasesType: typeof parsed.phases,
          });
        }
      } catch (parseError) {
        this.logger.error('Failed to parse AI coding plan, using fallback', {
          component: 'UniversalPlanGeneratorService',
          error:
            parseError instanceof Error
              ? parseError.message
              : String(parseError),
          responseLength: response.length,
          responsePreview: response.substring(0, 500),
          responseSuffix: response.substring(
            Math.max(0, response.length - 500),
          ),
        });
      }
    } catch (error) {
      this.logger.warn('AI coding plan failed, using fallback', {
        component: 'UniversalPlanGeneratorService',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Fallback plan
    const phases: PlanPhase[] = [];
    const hasGitHub = classification.integrations.includes('github');
    const hasVercel = classification.integrations.includes('vercel');
    const hasAWS = classification.integrations.includes('aws');

    // Extract app name for fallback
    const appNameMatch = task.userRequest.match(
      /(?:build|create|develop)\s+(?:a\s+)?([a-zA-Z0-9\s-]+?)(?:\s+(?:app|application|website|platform|system))/i,
    );
    const appName = appNameMatch
      ? appNameMatch[1].trim().toLowerCase().replace(/\s+/g, '-')
      : 'app';

    const isFullStack =
      task.userRequest.toLowerCase().includes('backend') &&
      task.userRequest.toLowerCase().includes('frontend');

    // Phase 1: GitHub Setup (MUST come before code generation)
    if (hasGitHub) {
      const githubSteps: PlanStep[] = [];

      // For full-stack projects, create separate backend and frontend repositories
      if (isFullStack || classification.complexity === 'high') {
        githubSteps.push({
          id: 'github_backend',
          tool: 'github_integration',
          action: 'createRepository',
          params: {
            repoName: `${appName}-backend`,
            description: `Backend API for ${appName} application`,
            private: false,
          },
          description: 'Create GitHub repository for backend API',
          estimatedDuration: 15,
        });

        githubSteps.push({
          id: 'github_frontend',
          tool: 'github_integration',
          action: 'createRepository',
          params: {
            repoName: `${appName}-frontend`,
            description: `Frontend application for ${appName}`,
            private: false,
          },
          description: 'Create GitHub repository for frontend application',
          estimatedDuration: 15,
        });
      } else {
        // Single repository for simple projects
        githubSteps.push({
          id: 'github_1',
          tool: 'github_integration',
          action: 'createRepository',
          params: {
            repoName: appName,
            description: `${appName} application`,
            private: false,
          },
          description:
            'Create GitHub repository, initialize with README, add .gitignore, and push initial code',
          estimatedDuration: 20,
        });
      }

      phases.push({
        name: 'Version Control Setup',
        approvalRequired: false, // Changed to false so repos are created immediately
        steps: githubSteps,
        riskLevel: 'medium',
      });
    }

    // Phase 2: Code Generation (AFTER GitHub repos are created)
    phases.push({
      name: 'Code Generation & Architecture',
      approvalRequired: false,
      steps: [
        {
          id: 'codegen_1',
          tool: 'code_generator',
          action: 'generate',
          params: {},
          description:
            'Generate application code with modern best practices, proper structure, and documentation',
          estimatedDuration: 60,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 3: Testing
    phases.push({
      name: 'Quality Assurance',
      approvalRequired: false,
      steps: [
        {
          id: 'test_1',
          tool: 'code_analyzer',
          action: 'validate',
          params: {},
          description:
            'Run linting, type checking, and basic code quality analysis',
          estimatedDuration: 30,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 4: Deployment
    if (hasVercel || hasAWS) {
      const deploymentSteps: PlanStep[] = [];

      if (hasVercel) {
        const frontendRepo = isFullStack ? `${appName}-frontend` : appName;
        deploymentSteps.push({
          id: 'deploy_vercel',
          tool: 'vercel_integration',
          action: 'deploy',
          params: {
            gitSource: {
              type: 'github',
              repo: `{{username}}/${frontendRepo}`,
            },
            framework: 'create-react-app',
          },
          description:
            'Deploy frontend application to Vercel with automatic HTTPS and CDN',
          estimatedDuration: 90,
        });
      }

      if (hasAWS) {
        deploymentSteps.push({
          id: 'deploy_aws',
          tool: 'aws_integration',
          action: 'deploy',
          params: {},
          description:
            'Deploy backend services to AWS with auto-scaling and load balancing',
          estimatedDuration: 150,
        });
      }

      phases.push({
        name: 'Production Deployment',
        approvalRequired: true,
        steps: deploymentSteps,
        riskLevel: 'high',
      });
    }

    // Phase 5: Post-Deployment
    if (hasVercel || hasAWS) {
      phases.push({
        name: 'Post-Deployment Verification',
        approvalRequired: false,
        steps: [
          {
            id: 'verify_1',
            tool: 'health_checker',
            action: 'verify',
            params: {},
            description:
              'Verify deployment health, test endpoints, and confirm accessibility',
            estimatedDuration: 15,
          },
        ],
        riskLevel: 'none',
      });
    }

    return phases;
  }

  /**
   * Generate plan for complex queries using task context
   */
  private generateQueryPlan(
    task: GovernedTask,
    classification: TaskClassification,
  ): PlanPhase[] {
    const integration = classification.integrations[0] || 'mongodb';
    const isMultiStep =
      classification.complexity === 'high' ||
      classification.integrations.length > 1;

    const phases: PlanPhase[] = [];

    // Phase 1: Query Preparation & Validation
    if (isMultiStep) {
      phases.push({
        name: 'Query Preparation',
        approvalRequired: false,
        steps: [
          {
            id: 'prepare_1',
            tool: `${integration}_integration`,
            action: 'validate',
            params: {
              userRequest: task.userRequest,
              userId: task.userId,
            },
            description: `Validate query parameters and prepare execution plan for: ${task.userRequest.substring(0, 80)}...`,
            estimatedDuration: 5,
          },
        ],
        riskLevel: 'none',
      });
    }

    // Phase 2: Execute Query
    phases.push({
      name: isMultiStep ? 'Execute Complex Query' : 'Execute Query',
      approvalRequired: false,
      steps: [
        {
          id: 'query_1',
          tool: `${integration}_integration`,
          action: 'query',
          params: {
            userRequest: task.userRequest,
            userId: task.userId,
            taskId: task.id,
          },
          description: `Execute ${classification.complexity} complexity query: ${task.userRequest.substring(0, 100)}`,
          estimatedDuration: isMultiStep ? 25 : 15,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 3: Result Processing (for complex queries)
    if (isMultiStep) {
      phases.push({
        name: 'Process Results',
        approvalRequired: false,
        steps: [
          {
            id: 'process_1',
            tool: 'data_processor',
            action: 'format',
            params: {
              taskId: task.id,
            },
            description:
              'Format and structure query results for optimal presentation',
            estimatedDuration: 5,
          },
        ],
        riskLevel: 'none',
      });
    }

    return phases;
  }

  /**
   * Generate plan for research tasks using task context
   */
  private generateResearchPlan(
    task: GovernedTask,
    research: ResearchResult,
  ): PlanPhase[] {
    const hasExtensiveSources = research.sources.length > 10;
    const phases: PlanPhase[] = [];

    // Phase 1: Source Analysis
    phases.push({
      name: 'Analyze Research Sources',
      approvalRequired: false,
      steps: [
        {
          id: 'analyze_1',
          tool: 'research_agent',
          action: 'analyze',
          params: {
            query: research.query,
            sourcesCount: research.sources.length,
            userId: task.userId,
            taskId: task.id,
          },
          description: `Analyze ${research.sources.length} research sources for: "${research.query.substring(0, 80)}${research.query.length > 80 ? '...' : ''}"`,
          estimatedDuration: hasExtensiveSources ? 15 : 8,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 2: Synthesis & Summary
    phases.push({
      name: 'Research Synthesis',
      approvalRequired: false,
      steps: [
        {
          id: 'synthesize_1',
          tool: 'research_agent',
          action: 'synthesize',
          params: {
            sources: research.sources,
            synthesis: research.synthesis,
            keyFindings: research.keyFindings,
            userRequest: task.userRequest,
            userId: task.userId,
            taskId: task.id,
          },
          description: `Synthesize research findings and generate comprehensive summary with ${research.keyFindings.length} key insights`,
          estimatedDuration: 12,
        },
      ],
      riskLevel: 'none',
    });

    // Phase 3: Generate Recommendations (if extensive research)
    if (hasExtensiveSources) {
      phases.push({
        name: 'Generate Recommendations',
        approvalRequired: false,
        steps: [
          {
            id: 'recommend_1',
            tool: 'research_agent',
            action: 'recommend',
            params: {
              synthesis: research.synthesis,
              keyFindings: research.keyFindings,
              userRequest: task.userRequest,
              userId: task.userId,
            },
            description:
              'Generate actionable recommendations based on research findings',
            estimatedDuration: 8,
          },
        ],
        riskLevel: 'none',
      });
    }

    return phases;
  }

  /**
   * Generate plan for simple queries using task context
   */
  private generateSimpleQueryPlan(
    task: GovernedTask,
    classification: TaskClassification,
  ): PlanPhase[] {
    const integration = classification.integrations[0] || 'api';
    const requiresAuthentication =
      classification.integrations.includes('github') ||
      classification.integrations.includes('google') ||
      classification.integrations.includes('jira');

    const phases: PlanPhase[] = [];

    // Add authentication check if needed
    if (requiresAuthentication) {
      phases.push({
        name: 'Authentication Check',
        approvalRequired: false,
        steps: [
          {
            id: 'auth_1',
            tool: `${integration}_integration`,
            action: 'verify_auth',
            params: {
              userId: task.userId,
              integration,
            },
            description: `Verify authentication credentials for ${integration}`,
            estimatedDuration: 2,
          },
        ],
        riskLevel: 'none',
      });
    }

    // Main execution
    phases.push({
      name: 'Direct Execution',
      approvalRequired: false,
      steps: [
        {
          id: 'execute_1',
          tool: `${integration}_integration`,
          action: 'execute',
          params: {
            userRequest: task.userRequest,
            userId: task.userId,
            taskId: task.id,
            integration,
          },
          description: `Execute simple ${integration} query: ${task.userRequest.substring(0, 100)}${task.userRequest.length > 100 ? '...' : ''}`,
          estimatedDuration: 5,
        },
      ],
      riskLevel: 'none',
    });

    return phases;
  }

  /**
   * Estimate comprehensive cost of plan execution
   */
  /**
   * Estimate the total monthly cost of plan execution based on the provided phases.
   *
   * - Uses up-to-date, reasonable cloud and SaaS cost estimates for prototyping and basic usage
   * - Accounts for typical free tiers when they apply
   * - Results are an approximation and intended for cost-awareness, not billing precision
   */
  private estimateCost(phases: PlanPhase[]): number {
    let total: number = 0;

    // Define constants for cost rates (in USD)
    const COSTS = {
      AWS_FARGATE_ECS: 25, // vCPU+RAM+LB approximation (with buffer)
      AWS_LAMBDA: 1, // base estimate, most likely free tier
      AWS_S3_10GB: 0.23, // 10GB/month
      VERCEL_PRO: 20, // not applied by default
      MONGODB_M10: 57, // not used: only M0 (free) is assumed
      GITHUB_TEAM: 4, // not applied by default
      OPENAI_CODE_GEN: 0.05, // estimate per code generation step (~50k tokens)
      OTHER_AI_CODE: 0.05, // fallback for other code/AI types
      ZERO: 0,
    };

    // Helper for normalization
    const toLower = (v?: string) => (v ? v.toLowerCase() : '');

    // Process each step in all phases
    for (const phase of phases) {
      for (const step of phase.steps) {
        const tool = toLower(step.tool);
        const action = toLower(step.action);
        const description = toLower(step.description);

        // --- AWS ---
        if (tool.includes('aws')) {
          if (action.includes('deploy')) {
            total += COSTS.AWS_FARGATE_ECS;
          } else if (action.includes('lambda')) {
            total += COSTS.AWS_LAMBDA;
          } else if (action.includes('s3')) {
            total += COSTS.AWS_S3_10GB;
          }
        }

        // --- Vercel ---
        else if (tool.includes('vercel')) {
          if (action.includes('deploy')) {
            // Default assumption: free (Hobby) tier is sufficient
            total += COSTS.ZERO;
          }
        }

        // --- MongoDB Atlas ---
        else if (tool.includes('mongodb')) {
          if (action.includes('create') && description.includes('cluster')) {
            // Default to free/M0
            total += COSTS.ZERO;
          }
        }

        // --- GitHub ---
        else if (tool.includes('github')) {
          // Default to free/OSS usage; add cost if see explicit team/private requests later
          total += COSTS.ZERO;
        }

        // --- AI code-gen/analyzer (OpenAI, etc) ---
        else if (
          tool.includes('code_generator') ||
          tool.includes('code_analyzer')
        ) {
          total += COSTS.OPENAI_CODE_GEN;
        }

        // --- Google & JIRA ---
        else if (tool.includes('google') || tool.includes('jira')) {
          // Assume user has (free/paid) subscription already
          total += COSTS.ZERO;
        }

        // --- Catch-all/Core LLM/AIOps steps (not covered above) ---
        else if (
          tool.includes('ai') ||
          tool.includes('llm') ||
          tool.includes('copilot')
        ) {
          total += COSTS.OTHER_AI_CODE;
        }
        // In future, extend for new cloud/saas/ai integrations here.
      }
    }

    // Round to two decimal places
    return Math.round(total * 100) / 100;
  }

  /**
   * Generate comprehensive rollback instructions
   */
  private generateRollbackPlan(phases: PlanPhase[]): string {
    const instructions: string[] = [];
    instructions.push('ROLLBACK INSTRUCTIONS');
    instructions.push('===================\n');
    instructions.push(
      'Execute these steps in reverse order if something goes wrong:\n',
    );

    let stepNumber = 1;

    // Process phases in reverse order
    for (let i = phases.length - 1; i >= 0; i--) {
      const phase = phases[i];

      // Process steps in reverse order within each phase
      for (let j = phase.steps.length - 1; j >= 0; j--) {
        const step = phase.steps[j];

        // Generate rollback for write operations
        if (
          step.action.includes('create') ||
          step.action.includes('deploy') ||
          step.action.includes('update') ||
          step.action.includes('modify')
        ) {
          let rollbackInstruction = '';

          // GitHub rollbacks
          if (step.tool.includes('github')) {
            if (step.action.includes('createRepository')) {
              rollbackInstruction = `Delete GitHub repository created in this step`;
            } else if (step.action.includes('push')) {
              rollbackInstruction = `Revert the last commit and force push`;
            }
          }

          // AWS rollbacks
          else if (step.tool.includes('aws')) {
            if (step.action.includes('deploy')) {
              rollbackInstruction = `Terminate AWS resources (ECS services, load balancers, etc.)`;
            } else if (step.action.includes('lambda')) {
              rollbackInstruction = `Delete Lambda function and associated triggers`;
            } else if (step.action.includes('s3')) {
              rollbackInstruction = `Empty and delete S3 bucket`;
            }
          }

          // Vercel rollbacks
          else if (step.tool.includes('vercel')) {
            rollbackInstruction = `Delete Vercel deployment or rollback to previous version`;
          }

          // MongoDB rollbacks
          else if (step.tool.includes('mongodb')) {
            if (step.action.includes('create')) {
              rollbackInstruction = `Delete documents/collections created in MongoDB`;
            } else if (step.action.includes('update')) {
              rollbackInstruction = `Restore from MongoDB backup or undo changes`;
            }
          }

          // Generic integration rollbacks
          else if (step.action.includes('create')) {
            const integration = step.tool.replace(/_integration$/, '');
            rollbackInstruction = `Delete resources created in ${integration}`;
          } else if (step.action.includes('update')) {
            const integration = step.tool.replace(/_integration$/, '');
            rollbackInstruction = `Restore previous state in ${integration}`;
          }

          // Google/JIRA rollbacks
          else if (step.tool.includes('google') || step.tool.includes('jira')) {
            if (step.action.includes('create')) {
              rollbackInstruction = `Delete items created in ${step.tool.replace('_integration', '')}`;
            }
          }

          if (rollbackInstruction) {
            instructions.push(
              `${stepNumber}. [${phase.name}] ${rollbackInstruction}`,
            );
            instructions.push(`   Tool: ${step.tool}`);
            instructions.push(`   Original Action: ${step.action}`);
            instructions.push(`   Context: ${step.description}\n`);
            stepNumber++;
          }
        }
      }
    }

    if (instructions.length === 4) {
      // Only header added
      return 'No rollback needed - all operations are read-only or non-destructive.';
    }

    instructions.push('\nIMPORTANT NOTES:');
    instructions.push('- Always backup data before rollback');
    instructions.push('- Verify each step before proceeding to the next');
    instructions.push('- Document any issues encountered during rollback');
    instructions.push('- Contact support if you need assistance');

    return instructions.join('\n');
  }
}
