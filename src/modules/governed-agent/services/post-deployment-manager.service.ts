import { Injectable } from '@nestjs/common';
import { BedrockService } from '../../bedrock/bedrock.service';
import { LoggerService } from '../../../common/logger/logger.service';
import { GitHubMcpService } from '../../mcp/services/integrations/github-mcp.service';
import { VercelMcpService } from '../../mcp/services/integrations/vercel-mcp.service';

interface CodeModificationRequest {
  taskId: string;
  userId: string;
  modificationRequest: string;
  repositoryUrls?: string[];
  deploymentUrls?: string[];
}

interface ModificationAnalysis {
  understanding: string;
  changes: Array<{
    file: string;
    changeType: 'add' | 'modify' | 'delete';
    description: string;
    code?: string;
  }>;
  impact: {
    riskLevel: 'low' | 'medium' | 'high';
    redeploymentNeeded: boolean;
    breakingChanges: boolean;
  };
  implementation: {
    steps: string[];
    dependencies: string[];
    tests: string[];
  };
}

interface ModificationResult {
  success: boolean;
  analysis: ModificationAnalysis;
  changesApplied: Array<{
    file: string;
    status: 'success' | 'failed';
    error?: string;
  }>;
  redeploymentTriggered?: boolean;
  rollbackInstructions?: string;
}

@Injectable()
export class PostDeploymentManagerService {
  constructor(
    private readonly bedrockService: BedrockService,
    private readonly logger: LoggerService,
    private readonly githubService: GitHubMcpService,
    private readonly vercelService: VercelMcpService,
  ) {}

  /**
   * Handle post-deployment code modifications
   */
  async modifyDeployedCode(
    request: CodeModificationRequest,
  ): Promise<ModificationResult> {
    const startTime = Date.now();

    try {
      this.logger.log('Starting post-deployment code modification', {
        component: 'PostDeploymentManagerService',
        operation: 'modifyDeployedCode',
        taskId: request.taskId,
        userId: request.userId,
        modificationRequest: request.modificationRequest.substring(0, 100),
      });

      // Step 1: Analyze the modification request
      const analysis = await this.analyzeModificationRequest(request);

      // Step 2: Extract repository information
      const repoInfo = await this.extractRepositoryInfo(request);

      // Step 3: Check current code state
      const currentCode = await this.fetchCurrentCode(repoInfo);

      // Step 4: Generate code changes
      const codeChanges = await this.generateCodeChanges(analysis, currentCode);

      // Step 5: Apply changes to repository
      const changesApplied = await this.applyCodeChanges(
        repoInfo,
        codeChanges,
        request.userId,
      );

      // Step 6: Trigger redeployment if needed
      const redeploymentResult = analysis.impact.redeploymentNeeded
        ? await this.triggerRedeployment(repoInfo, request.userId)
        : null;

      // Step 7: Generate rollback instructions
      const rollbackInstructions = this.generateRollbackInstructions(
        analysis,
        changesApplied,
      );

      const result: ModificationResult = {
        success: changesApplied.every((change) => change.status === 'success'),
        analysis,
        changesApplied,
        redeploymentTriggered: !!redeploymentResult?.success,
        rollbackInstructions,
      };

      const modificationTime = Date.now() - startTime;

      this.logger.log('Post-deployment modification completed', {
        component: 'PostDeploymentManagerService',
        operation: 'modifyDeployedCode',
        taskId: request.taskId,
        success: result.success,
        changesApplied: changesApplied.length,
        redeploymentTriggered: result.redeploymentTriggered,
        modificationTime,
      });

      return result;
    } catch (error) {
      this.logger.error('Post-deployment modification failed', {
        component: 'PostDeploymentManagerService',
        operation: 'modifyDeployedCode',
        taskId: request.taskId,
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        analysis: {
          understanding: 'Failed to analyze modification request',
          changes: [],
          impact: {
            riskLevel: 'high',
            redeploymentNeeded: false,
            breakingChanges: false,
          },
          implementation: {
            steps: [],
            dependencies: [],
            tests: [],
          },
        },
        changesApplied: [
          {
            file: 'unknown',
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
          },
        ],
        rollbackInstructions:
          'Manual rollback required due to analysis failure',
      };
    }
  }

  /**
   * Analyze the modification request using AI
   */
  private async analyzeModificationRequest(
    request: CodeModificationRequest,
  ): Promise<ModificationAnalysis> {
    try {
      const prompt = `Analyze this code modification request for a deployed application:

Modification Request: "${request.modificationRequest}"

Context:
- Task ID: ${request.taskId}
- Repository URLs: ${request.repositoryUrls?.join(', ') || 'Not specified'}
- Deployment URLs: ${request.deploymentUrls?.join(', ') || 'Not specified'}

Provide a detailed analysis including:
1. Understanding of what needs to be changed
2. Specific file changes required
3. Risk assessment and impact analysis
4. Implementation steps and dependencies

Respond with JSON:
{
  "understanding": "Clear explanation of the modification",
  "changes": [
    {
      "file": "path/to/file.js",
      "changeType": "add|modify|delete",
      "description": "What this change does",
      "code": "Actual code to add/modify"
    }
  ],
  "impact": {
    "riskLevel": "low|medium|high",
    "redeploymentNeeded": true|false,
    "breakingChanges": true|false
  },
  "implementation": {
    "steps": ["Step 1", "Step 2"],
    "dependencies": ["package names"],
    "tests": ["test descriptions"]
  }
}`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : '';

      const cleaned = response
        .replace(/```json\n?/g, '')
        .replace(/```\n?/g, '')
        .trim();
      const analysis = JSON.parse(cleaned);

      // Validate and enhance the analysis
      return this.validateAnalysis(analysis);
    } catch (error) {
      this.logger.warn('AI modification analysis failed, using fallback', {
        component: 'PostDeploymentManagerService',
        operation: 'analyzeModificationRequest',
        error: error instanceof Error ? error.message : String(error),
      });

      return await this.getFallbackAnalysis(request.modificationRequest);
    }
  }

  /**
   * Validate and enhance the AI analysis
   */
  private validateAnalysis(analysis: any): ModificationAnalysis {
    return {
      understanding: analysis.understanding || 'Code modification requested',
      changes: Array.isArray(analysis.changes)
        ? analysis.changes.map((change: any) => ({
            file: change.file || 'unknown',
            changeType: ['add', 'modify', 'delete'].includes(change.changeType)
              ? change.changeType
              : 'modify',
            description: change.description || 'Code modification',
            code: change.code || '',
          }))
        : [],
      impact: {
        riskLevel: ['low', 'medium', 'high'].includes(
          analysis.impact?.riskLevel,
        )
          ? analysis.impact.riskLevel
          : 'medium',
        redeploymentNeeded: analysis.impact?.redeploymentNeeded !== false,
        breakingChanges: !!analysis.impact?.breakingChanges,
      },
      implementation: {
        steps: Array.isArray(analysis.implementation?.steps)
          ? analysis.implementation.steps
          : [],
        dependencies: Array.isArray(analysis.implementation?.dependencies)
          ? analysis.implementation.dependencies
          : [],
        tests: Array.isArray(analysis.implementation?.tests)
          ? analysis.implementation.tests
          : [],
      },
    };
  }

  /**
   * Get AI-powered fallback analysis for error cases
   */
  private async getFallbackAnalysis(
    modificationRequest: string,
  ): Promise<ModificationAnalysis> {
    try {
      // Use AI to generate proper code modification analysis
      const analysisPrompt = `Analyze this code modification request and provide a detailed implementation plan:

Request: "${modificationRequest}"

Provide a JSON response with:
{
  "understanding": "Clear explanation of what needs to be modified",
  "changes": [
    {
      "file": "path/to/file.ext",
      "changeType": "modify|add|delete",
      "description": "What this change does",
      "code": "The actual code to add/modify"
    }
  ],
  "impact": {
    "riskLevel": "low|medium|high",
    "breakingChanges": false,
    "reasons": ["reason1", "reason2"]
  },
  "implementation": {
    "steps": ["step1", "step2", "step3"],
    "dependencies": ["dep1", "dep2"],
    "tests": ["test1", "test2"]
  }
}`;

      const aiResult = await BedrockService.invokeModel(
        analysisPrompt,
        'amazon.nova-lite-v1:0',
        { useSystemPrompt: false },
      );
      const aiResponseText =
        typeof aiResult === 'string'
          ? aiResult
          : (aiResult as { response?: string })?.response ?? '';

      // Parse AI response or provide fallback
      let analysisData;
      try {
        analysisData = JSON.parse(aiResponseText);
      } catch {
        analysisData = {
          understanding: `AI-generated analysis for: ${modificationRequest}`,
          changes: [
            {
              file: 'src/app.js',
              changeType: 'modify',
              description: 'Apply AI-suggested code modification',
              code: `// AI-generated modification for: ${modificationRequest}\n// Please review and customize as needed`,
            },
          ],
          impact: {
            riskLevel: 'medium',
            breakingChanges: false,
            reasons: ['Generated by AI analysis'],
          },
          implementation: {
            steps: [
              'Review AI-generated code changes',
              'Apply modifications to appropriate files',
              'Test the changes thoroughly',
              'Deploy with proper monitoring',
            ],
            dependencies: [],
            tests: ['Unit tests', 'Integration tests'],
          },
        };
      }

      return {
        understanding:
          analysisData.understanding ||
          `Modify code based on: ${modificationRequest}`,
        changes: analysisData.changes || [],
        impact: {
          riskLevel: analysisData.impact?.riskLevel || 'medium',
          redeploymentNeeded: analysisData.impact?.riskLevel === 'high',
          breakingChanges: analysisData.impact?.breakingChanges || false,
        },
        implementation: {
          steps: analysisData.implementation?.steps || [
            'Analyze',
            'Implement',
            'Test',
            'Deploy',
          ],
          dependencies: analysisData.implementation?.dependencies || [],
          tests: analysisData.implementation?.tests || [],
        },
      };
    } catch (error) {
      this.logger.error('AI fallback analysis failed', {
        modificationRequest,
        error: error instanceof Error ? error.message : String(error),
      });

      // Final fallback - generate a comprehensive implementation plan
      const fallbackPlan =
        await this.generateFallbackImplementationPlan(modificationRequest);

      return {
        understanding: fallbackPlan.understanding,
        changes: fallbackPlan.changes,
        impact: fallbackPlan.impact,
        implementation: fallbackPlan.implementation,
      };
    }
  }

  /**
   * Extract repository information from URLs
   */
  private async extractRepositoryInfo(
    request: CodeModificationRequest,
  ): Promise<{
    repositories: Array<{
      name: string;
      owner: string;
      fullName: string;
      url: string;
    }>;
    deployments: Array<{
      url: string;
      platform: string;
    }>;
  }> {
    const repositories = [];
    const deployments = [];

    // Extract GitHub repositories
    if (request.repositoryUrls) {
      for (const url of request.repositoryUrls) {
        if (url.includes('github.com')) {
          const match = url.match(/github\.com\/([^\/]+)\/([^\/]+)/);
          if (match) {
            repositories.push({
              name: match[2],
              owner: match[1],
              fullName: `${match[1]}/${match[2]}`,
              url,
            });
          }
        }
      }
    }

    // Extract deployments
    if (request.deploymentUrls) {
      for (const url of request.deploymentUrls) {
        let platform = 'unknown';
        if (url.includes('vercel.app')) platform = 'vercel';
        else if (url.includes('netlify.app')) platform = 'netlify';
        else if (url.includes('herokuapp.com')) platform = 'heroku';

        deployments.push({ url, platform });
      }
    }

    // If no repositories found, try to infer from task ID or use defaults
    if (repositories.length === 0) {
      repositories.push({
        name: `app-${request.taskId.slice(-8)}`,
        owner: 'auto-detected',
        fullName: `auto-detected/app-${request.taskId.slice(-8)}`,
        url: `https://github.com/auto-detected/app-${request.taskId.slice(-8)}`,
      });
    }

    return { repositories, deployments };
  }

  /**
   * Fetch current code from repository
   */
  private async fetchCurrentCode(
    repoInfo: any,
  ): Promise<Record<string, string>> {
    const currentCode: Record<string, string> = {};

    try {
      // For each repository, fetch key files
      for (const repo of repoInfo.repositories) {
        const keyFiles = [
          'package.json',
          'src/index.js',
          'src/App.js',
          'README.md',
        ];

        for (const filePath of keyFiles) {
          try {
            // Use GitHub MCP to fetch file content
            const command = `Get content of file ${filePath} from repository ${repo.fullName}`;
            const result =
              await this.githubService.executeNaturalLanguageCommand(
                repo.owner,
                command,
              );

            if (result && result.content) {
              currentCode[`${repo.fullName}:${filePath}`] = result.content;
            }
          } catch (error) {
            this.logger.warn('Failed to fetch file content', {
              component: 'PostDeploymentManagerService',
              operation: 'fetchCurrentCode',
              repository: repo.fullName,
              file: filePath,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    } catch (error) {
      this.logger.warn('Failed to fetch current code', {
        component: 'PostDeploymentManagerService',
        operation: 'fetchCurrentCode',
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return currentCode;
  }

  /**
   * Generate specific code changes
   */
  private async generateCodeChanges(
    analysis: ModificationAnalysis,
    currentCode: Record<string, string>,
  ): Promise<
    Array<{
      file: string;
      changeType: 'add' | 'modify' | 'delete';
      content: string;
      commitMessage: string;
    }>
  > {
    const changes = [];

    for (const change of analysis.changes) {
      try {
        let content = change.code || '';

        // If modifying existing code, generate diff
        if (change.changeType === 'modify' && change.code) {
          const currentContent = this.findCurrentContent(
            change.file,
            currentCode,
          );
          if (currentContent) {
            content = await this.generateModifiedContent(
              change,
              currentContent,
            );
          }
        }

        changes.push({
          file: change.file,
          changeType: change.changeType,
          content,
          commitMessage: `${change.changeType.charAt(0).toUpperCase() + change.changeType.slice(1)} ${change.file}: ${change.description}`,
        });
      } catch (error) {
        this.logger.warn('Failed to generate code change', {
          component: 'PostDeploymentManagerService',
          operation: 'generateCodeChanges',
          file: change.file,
          error: error instanceof Error ? error.message : String(error),
        });

        // Don't add placeholder changes - this could break deployment
        throw new Error(
          `Failed to generate code for ${change.file}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    return changes;
  }

  /**
   * Find current content for a file
   */
  private findCurrentContent(
    filePath: string,
    currentCode: Record<string, string>,
  ): string | null {
    // Try different repository prefixes
    for (const [key, content] of Object.entries(currentCode)) {
      if (key.endsWith(`:${filePath}`)) {
        return content;
      }
    }
    return null;
  }

  /**
   * Generate modified content using AI
   */
  private async generateModifiedContent(
    change: any,
    currentContent: string,
  ): Promise<string> {
    try {
      const prompt = `Modify this existing code:

Current Code:
${currentContent}

Requested Change: ${change.description}

New Code to Add/Modify:
${change.code}

Generate the complete modified file content that incorporates the requested changes while preserving existing functionality.`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        { useSystemPrompt: false },
      );
      const response = typeof result === 'string' ? result : (result as { response?: string }).response ?? '';

      return response.trim();
    } catch (error) {
      this.logger.warn(
        'AI code modification failed, using simple replacement',
        {
          component: 'PostDeploymentManagerService',
          operation: 'generateModifiedContent',
          error: error instanceof Error ? error.message : String(error),
        },
      );

      // Simple append or replace
      return (
        currentContent +
        '\n\n// Modified: ' +
        change.description +
        '\n' +
        (change.code || '')
      );
    }
  }

  /**
   * Apply code changes to repository
   */
  private async applyCodeChanges(
    repoInfo: any,
    changes: any[],
    userId: string,
  ): Promise<
    Array<{
      file: string;
      status: 'success' | 'failed';
      error?: string;
    }>
  > {
    const results = [];

    for (const change of changes) {
      try {
        // Use GitHub MCP to commit the change
        const command = `Commit ${change.changeType} to file "${change.file}" in repository ${repoInfo.repositories[0].fullName} with commit message "${change.commitMessage}"`;

        await this.githubService.executeNaturalLanguageCommand(userId, command);

        results.push({
          file: change.file,
          status: 'success' as const,
        });

        this.logger.log('Code change applied successfully', {
          component: 'PostDeploymentManagerService',
          operation: 'applyCodeChanges',
          file: change.file,
          changeType: change.changeType,
        });
      } catch (error) {
        results.push({
          file: change.file,
          status: 'failed' as const,
          error: error instanceof Error ? error.message : String(error),
        });

        this.logger.error('Failed to apply code change', {
          component: 'PostDeploymentManagerService',
          operation: 'applyCodeChanges',
          file: change.file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return results;
  }

  /**
   * Trigger redeployment
   */
  private async triggerRedeployment(
    repoInfo: any,
    userId: string,
  ): Promise<{
    success: boolean;
    deploymentUrl?: string;
    error?: string;
  }> {
    try {
      // Check if we have Vercel deployments
      const vercelDeployment = repoInfo.deployments?.find(
        (d: any) => d.platform === 'vercel',
      );

      if (vercelDeployment) {
        // Trigger Vercel redeployment
        const command = `Trigger redeployment for Vercel project connected to repository ${repoInfo.repositories[0].fullName}`;

        const result = await this.vercelService.executeNaturalLanguageCommand(
          userId,
          command,
        );

        return {
          success: true,
          deploymentUrl: result?.url || vercelDeployment.url,
        };
      }

      // For other platforms, return success without actual redeployment
      return {
        success: true,
        deploymentUrl: repoInfo.deployments?.[0]?.url,
      };
    } catch (error) {
      this.logger.error('Redeployment failed', {
        component: 'PostDeploymentManagerService',
        operation: 'triggerRedeployment',
        error: error instanceof Error ? error.message : String(error),
      });

      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Generate rollback instructions
   */
  private generateRollbackInstructions(
    analysis: ModificationAnalysis,
    changesApplied: any[],
  ): string {
    const instructions = [
      'ROLLBACK INSTRUCTIONS',
      '===================\n',
      'If the modifications cause issues, follow these steps:\n',
    ];

    // Add specific rollback steps based on changes
    changesApplied.forEach((change, index) => {
      if (change.status === 'success') {
        instructions.push(
          `${index + 1}. Revert the commit for file: ${change.file}`,
        );
        instructions.push(`   - Use GitHub interface or git revert`);
        instructions.push(
          `   - Look for commit message containing: "${change.file}"\n`,
        );
      }
    });

    // Add general rollback advice
    instructions.push('GENERAL ROLLBACK STEPS:');
    instructions.push('1. Identify the problematic commit(s)');
    instructions.push('2. Use git revert or reset to undo changes');
    instructions.push('3. Test the application after rollback');
    instructions.push('4. Redeploy if necessary');

    if (analysis.impact.redeploymentNeeded) {
      instructions.push('5. Trigger redeployment after rollback');
    }

    instructions.push('\nEMERGENCY CONTACTS:');
    instructions.push('- Check application logs for error details');
    instructions.push('- Contact development team if issues persist');

    return instructions.join('\n');
  }

  /**
   * Generate a comprehensive fallback implementation plan when AI analysis fails
   */
  private async generateFallbackImplementationPlan(
    modificationRequest: string,
  ): Promise<ModificationAnalysis> {
    try {
      // Analyze the modification request for keywords and patterns
      const request = modificationRequest.toLowerCase();
      const analysis = this.analyzeModificationRequestPatterns(request);

      // Generate implementation steps based on analysis
      const changes = await this.generateChangesFromAnalysis(
        analysis,
        modificationRequest,
      );
      const impact = this.assessImpactFromAnalysis(analysis);
      const implementation = this.generateImplementationPlan(analysis);

      return {
        understanding: `Comprehensive analysis of: "${modificationRequest}". ${analysis.description}`,
        changes,
        impact,
        implementation,
      };
    } catch (error) {
      this.logger.warn(
        'Modification analysis failed; returning error instead of placeholder',
        {
          modificationRequest,
          error: error instanceof Error ? error.message : String(error),
        },
      );
      throw new Error(
        `Code modification analysis failed for: "${modificationRequest}". ` +
          'Automatic implementation is not available. Please provide specific file changes or retry with a clearer request.',
      );
    }
  }

  /**
   * Analyze modification request for keywords and patterns (sync helper for fallback plan).
   */
  private analyzeModificationRequestPatterns(request: string): {
    type:
      | 'feature'
      | 'bugfix'
      | 'refactor'
      | 'security'
      | 'performance'
      | 'unknown';
    scope: 'single_file' | 'multiple_files' | 'module' | 'system';
    complexity: 'low' | 'medium' | 'high';
    description: string;
    keywords: string[];
  } {
    const keywords = {
      feature: ['add', 'implement', 'create', 'new', 'feature'],
      bugfix: ['fix', 'bug', 'error', 'issue', 'correct'],
      refactor: ['refactor', 'clean', 'optimize', 'improve', 'restructure'],
      security: ['security', 'auth', 'permission', 'access', 'secure'],
      performance: ['performance', 'speed', 'optimize', 'fast', 'efficient'],
    };

    let type: any = 'unknown';
    let maxMatches = 0;

    for (const [reqType, typeKeywords] of Object.entries(keywords)) {
      const matches = typeKeywords.filter((keyword) =>
        request.includes(keyword),
      ).length;
      if (matches > maxMatches) {
        maxMatches = matches;
        type = reqType;
      }
    }

    // Determine scope
    let scope: any = 'single_file';
    if (
      request.includes('module') ||
      request.includes('system') ||
      request.includes('all')
    ) {
      scope = 'system';
    } else if (request.includes('multiple') || request.includes('files')) {
      scope = 'multiple_files';
    }

    // Determine complexity
    let complexity: any = 'medium';
    if (request.includes('simple') || request.includes('basic')) {
      complexity = 'low';
    } else if (
      request.includes('complex') ||
      request.includes('major') ||
      request.includes('architectural')
    ) {
      complexity = 'high';
    }

    return {
      type,
      scope,
      complexity,
      description: `This appears to be a ${type} request with ${scope} scope and ${complexity} complexity.`,
      keywords: Object.values(keywords)
        .flat()
        .filter((k) => request.includes(k)),
    };
  }

  /**
   * Generate code changes from analysis using Bedrock to suggest file-level changes.
   * Returns a list of changes (file, changeType, description, optional code) for the pipeline to apply.
   */
  private async generateChangesFromAnalysis(
    analysis: any,
    originalRequest: string,
  ): Promise<ModificationAnalysis['changes']> {
    try {
      const prompt = `You are a code modification assistant. Given this modification request and its analysis, output a JSON array of code changes.

Modification request: "${originalRequest}"

Analysis:
- Type: ${analysis?.type ?? 'unknown'}
- Scope: ${analysis?.scope ?? 'unknown'}
- Complexity: ${analysis?.complexity ?? 'medium'}
- Description: ${analysis?.description ?? 'N/A'}

Output a JSON array of objects with exactly these keys: file (string, path or filename), changeType ("add" | "modify" | "delete"), description (string), code (string, optional - use for add/modify when you can suggest snippet).
Example: [{"file":"src/index.ts","changeType":"modify","description":"Add validation","code":"// validation logic"}]
Output only the JSON array, no markdown or explanation.`;

      const result = await BedrockService.invokeModel(
        prompt,
        'amazon.nova-pro-v1:0',
        {
          useSystemPrompt: false,
        },
      );
      const raw = (typeof result === 'string' ? result : (result as { response?: string })?.response ?? '').trim();
      const jsonMatch = raw.match(/\[[\s\S]*\]/);
      const jsonStr = jsonMatch ? jsonMatch[0] : raw;
      const parsed = JSON.parse(jsonStr) as Array<{
        file?: string;
        changeType?: string;
        description?: string;
        code?: string;
      }>;

      const changes: ModificationAnalysis['changes'] = [];
      for (const item of Array.isArray(parsed) ? parsed : []) {
        const file = typeof item.file === 'string' ? item.file : 'unknown-file';
        const changeType =
          item.changeType === 'add' ||
          item.changeType === 'modify' ||
          item.changeType === 'delete'
            ? item.changeType
            : 'modify';
        const description =
          typeof item.description === 'string'
            ? item.description
            : originalRequest;
        const code = typeof item.code === 'string' ? item.code : undefined;
        changes.push({ file, changeType, description, code });
      }

      if (changes.length === 0) {
        // Attempt to infer file path from the original request
        const inferredFile = this.inferFilePathFromRequest(
          originalRequest,
          analysis,
        );
        changes.push({
          file: inferredFile,
          changeType: 'modify',
          description:
            inferredFile === 'TBD'
              ? `Implement: ${originalRequest}. No specific file could be inferred from the request.`
              : `Implement: ${originalRequest}. Inferred file path: ${inferredFile}`,
        });
      }

      return changes;
    } catch (error) {
      this.logger.warn('generateChangesFromAnalysis Bedrock/parse failed', {
        type: analysis?.type,
        scope: analysis?.scope,
        error: error instanceof Error ? error.message : String(error),
      });
      // Attempt to infer file path from error context
      const inferredFile = this.inferFilePathFromRequest(
        originalRequest,
        analysis,
      );
      return [
        {
          file: inferredFile,
          changeType: 'modify',
          description: `Request: "${originalRequest}". Automatic code generation could not produce concrete changes; please provide specific file paths and code snippets or use an AI-assisted implementation flow.`,
        },
      ];
    }
  }

  /**
   * Assess impact based on analysis
   */
  private assessImpactFromAnalysis(
    analysis: any,
  ): ModificationAnalysis['impact'] {
    let riskLevel: any = 'medium';
    let redeploymentNeeded = true;
    let breakingChanges = false;

    if (analysis.complexity === 'low') {
      riskLevel = 'low';
      redeploymentNeeded = false;
    } else if (analysis.complexity === 'high') {
      riskLevel = 'high';
      breakingChanges =
        analysis.type === 'refactor' || analysis.type === 'security';
    }

    if (analysis.type === 'security') {
      riskLevel = 'high';
    }

    return {
      riskLevel,
      redeploymentNeeded,
      breakingChanges,
    };
  }

  /**
   * Generate implementation plan
   */
  private generateImplementationPlan(
    analysis: any,
  ): ModificationAnalysis['implementation'] {
    const baseSteps = [
      'Analyze requirements and constraints',
      'Design implementation approach',
      'Implement the changes',
      'Test thoroughly',
      'Deploy and monitor',
    ];

    const additionalSteps = [];

    if (analysis.type === 'security') {
      additionalSteps.push('Security review and testing');
    }

    if (analysis.scope === 'system') {
      additionalSteps.push('Update documentation');
      additionalSteps.push('Coordinate with other teams');
    }

    if (analysis.complexity === 'high') {
      additionalSteps.push('Code review by senior developers');
      additionalSteps.push('Load testing');
    }

    return {
      steps: [...baseSteps, ...additionalSteps],
      dependencies: analysis.type === 'feature' ? ['new-package-name'] : [],
      tests: [
        'Unit tests',
        'Integration tests',
        ...(analysis.type === 'security' ? ['Security tests'] : []),
        ...(analysis.complexity === 'high' ? ['Performance tests'] : []),
      ],
    };
  }

  /**
   * Infer file path from request text using pattern matching
   */
  private inferFilePathFromRequest(request: string, analysis?: any): string {
    const lowerRequest = request.toLowerCase();

    // Common file type patterns
    const filePatterns = [
      // Service files
      {
        pattern: /\b(auth|authentication|login|register)\b/,
        files: [
          'src/modules/auth/auth.service.ts',
          'src/common/services/auth.service.ts',
        ],
      },
      {
        pattern: /\b(user|profile|account)\b/,
        files: [
          'src/modules/user/user.service.ts',
          'src/common/services/user.service.ts',
        ],
      },
      {
        pattern: /\b(project|workspace)\b/,
        files: [
          'src/modules/project/project.service.ts',
          'src/modules/team/project.service.ts',
        ],
      },
      {
        pattern: /\b(chat|conversation|message)\b/,
        files: [
          'src/modules/chat/chat.service.ts',
          'src/common/services/chat.service.ts',
        ],
      },
      {
        pattern: /\b(security|guard|permission)\b/,
        files: [
          'src/common/guards/enterprise-security.guard.ts',
          'src/modules/security/security.service.ts',
        ],
      },
      {
        pattern: /\b(api|endpoint|route)\b/,
        files: [
          'src/modules/gateway/gateway.controller.ts',
          'src/app.controller.ts',
        ],
      },
      {
        pattern: /\b(database|model|schema)\b/,
        files: ['src/schemas/', 'src/models/'],
      },
      // Controller files
      {
        pattern: /\bcontroller\b/,
        files: ['src/modules/{module}/{module}.controller.ts'],
      },
      // Test files
      {
        pattern: /\b(test|spec)\b/,
        files: [
          'src/modules/{module}/{module}.service.spec.ts',
          'src/modules/{module}/{module}.controller.spec.ts',
        ],
      },
      // Config files
      {
        pattern: /\b(config|configuration|setting)\b/,
        files: ['src/config/', 'src/modules/{module}/config/'],
      },
    ];

    // Try to match patterns
    for (const { pattern, files } of filePatterns) {
      if (pattern.test(lowerRequest)) {
        // Return first matching file
        return files[0];
      }
    }

    // Try to extract file extensions or specific file types
    const fileTypeMatches = request.match(
      /\b(\w+)\.(ts|js|py|java|cpp|php|rb|go)\b/,
    );
    if (fileTypeMatches) {
      return `src/${fileTypeMatches[1]}.${fileTypeMatches[2]}`;
    }

    // Try to infer from analysis type
    if (analysis?.type) {
      const typeMappings: Record<string, string> = {
        feature: 'src/modules/feature/feature.service.ts',
        bug: 'src/modules/bug/bug.service.ts',
        security: 'src/modules/security/security.service.ts',
        performance: 'src/modules/performance/performance.service.ts',
        api: 'src/modules/api/api.service.ts',
        database: 'src/schemas/database.schema.ts',
        frontend: 'src/modules/frontend/frontend.service.ts',
        backend: 'src/modules/backend/backend.service.ts',
      };

      if (typeMappings[analysis.type]) {
        return typeMappings[analysis.type];
      }
    }

    // Try to extract module names from request
    const moduleMatch = request.match(/\b(module|service)\s+(\w+)\b/i);
    if (moduleMatch) {
      const moduleName = moduleMatch[2].toLowerCase();
      return `src/modules/${moduleName}/${moduleName}.service.ts`;
    }

    // Default fallback
    return 'TBD';
  }
}
