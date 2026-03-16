import { Injectable, Logger } from '@nestjs/common';
import { AIRouterService } from '../../cortex/services/ai-router.service';
import {
  GithubAnalysisService,
  AnalysisResult,
} from './github-analysis.service';

export interface IFeatureConfig {
  name: string;
  config?: Record<string, any>;
}

export interface CodeGenerationRequest {
  repositoryFullName: string;
  integrationType: 'npm' | 'cli' | 'python' | 'http-headers';
  selectedFeatures: IFeatureConfig[];
  analysisResults: AnalysisResult;
}

export interface GeneratedCode {
  files: Array<{
    path: string;
    content: string;
    description: string;
  }>;
  packageJson?: {
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };
  requirementsTxt?: string[];
  setupInstructions: string[];
  environmentVariables: Array<{
    name: string;
    description: string;
    required: boolean;
    default?: string;
  }>;
}

@Injectable()
export class GithubCodeGeneratorService {
  private readonly logger = new Logger(GithubCodeGeneratorService.name);

  constructor(
    private readonly aiRouterService: AIRouterService,
    private readonly githubAnalysisService: GithubAnalysisService,
  ) {}

  /**
   * Generate integration code based on analysis results
   */
  async generateIntegrationCode(
    request: CodeGenerationRequest,
  ): Promise<GeneratedCode> {
    try {
      this.logger.log('Starting code generation', {
        repository: request.repositoryFullName,
        integrationType: request.integrationType,
        featuresCount: request.selectedFeatures.length,
      });

      const generatedCode: GeneratedCode = {
        files: [],
        setupInstructions: [],
        environmentVariables: [],
      };

      // Generate code based on integration type
      switch (request.integrationType) {
        case 'npm':
          await this.generateNPMIntegration(request, generatedCode);
          break;
        case 'cli':
          await this.generateCLIIntegration(request, generatedCode);
          break;
        case 'python':
          await this.generatePythonIntegration(request, generatedCode);
          break;
        case 'http-headers':
          await this.generateHTTPHeadersIntegration(request, generatedCode);
          break;
        default:
          throw new Error(
            `Unsupported integration type: ${request.integrationType}`,
          );
      }

      this.logger.log('Code generation completed', {
        repository: request.repositoryFullName,
        filesGenerated: generatedCode.files.length,
      });

      return generatedCode;
    } catch (error: any) {
      this.logger.error('Code generation failed', {
        repository: request.repositoryFullName,
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }

  /**
   * Generate NPM package integration
   */
  private async generateNPMIntegration(
    request: CodeGenerationRequest,
    generatedCode: GeneratedCode,
  ): Promise<void> {
    const { analysisResults, selectedFeatures } = request;

    // Generate main integration file
    const mainFile = this.generateNPMMainFile(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(mainFile);

    // Generate types file if TypeScript
    if (analysisResults.isTypeScriptPrimary) {
      const typesFile = this.generateNPMTypesFile(selectedFeatures);
      generatedCode.files.push(typesFile);
    }

    // Generate README
    const readmeFile = this.generateNPMReadme(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(readmeFile);

    // Update package.json
    generatedCode.packageJson = this.generatePackageJson(
      analysisResults,
      selectedFeatures,
    );

    // Add environment variables
    generatedCode.environmentVariables = [
      {
        name: 'COST_KATANA_API_KEY',
        description: 'API key for Cost Katana service',
        required: true,
      },
      {
        name: 'COST_KATANA_BASE_URL',
        description: 'Base URL for Cost Katana API',
        required: false,
        default: 'https://api.costkatana.com',
      },
    ];

    // Add setup instructions
    generatedCode.setupInstructions = [
      'Install the generated package: npm install',
      'Import and initialize in your code',
      'Set environment variables',
      'Test the integration',
    ];
  }

  /**
   * Generate CLI integration
   */
  private async generateCLIIntegration(
    request: CodeGenerationRequest,
    generatedCode: GeneratedCode,
  ): Promise<void> {
    const { analysisResults, selectedFeatures } = request;

    // Generate CLI entry point
    const cliFile = this.generateCLIEntryPoint(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(cliFile);

    // Generate CLI helper functions
    const helpersFile = this.generateCLIHelpers(selectedFeatures);
    generatedCode.files.push(helpersFile);

    // Generate README
    const readmeFile = this.generateCLIReadme(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(readmeFile);

    // Update package.json
    generatedCode.packageJson = this.generateCLIPackageJson(
      analysisResults,
      selectedFeatures,
    );

    // Add environment variables
    generatedCode.environmentVariables = [
      {
        name: 'COST_KATANA_API_KEY',
        description: 'API key for Cost Katana service',
        required: true,
      },
      {
        name: 'COST_KATANA_BASE_URL',
        description: 'Base URL for Cost Katana API',
        required: false,
        default: 'https://api.costkatana.com',
      },
    ];

    // Add setup instructions
    generatedCode.setupInstructions = [
      'Install the generated package: npm install',
      'Run the CLI command to test integration',
      'Set environment variables',
      'Configure your build scripts',
    ];
  }

  /**
   * Generate Python integration
   */
  private async generatePythonIntegration(
    request: CodeGenerationRequest,
    generatedCode: GeneratedCode,
  ): Promise<void> {
    const { analysisResults, selectedFeatures } = request;

    // Generate main Python module
    const mainFile = this.generatePythonMainModule(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(mainFile);

    // Generate __init__.py
    const initFile = this.generatePythonInitFile();
    generatedCode.files.push(initFile);

    // Generate README
    const readmeFile = this.generatePythonReadme(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(readmeFile);

    // Generate requirements.txt
    generatedCode.requirementsTxt = ['requests>=2.25.0', 'cost-katana>=1.0.0'];

    // Add environment variables
    generatedCode.environmentVariables = [
      {
        name: 'COST_KATANA_API_KEY',
        description: 'API key for Cost Katana service',
        required: true,
      },
      {
        name: 'COST_KATANA_BASE_URL',
        description: 'Base URL for Cost Katana API',
        required: false,
        default: 'https://api.costkatana.com',
      },
    ];

    // Add setup instructions
    generatedCode.setupInstructions = [
      'Install requirements: pip install -r requirements.txt',
      'Import and initialize in your Python code',
      'Set environment variables',
      'Test the integration',
    ];
  }

  /**
   * Generate HTTP headers integration
   */
  private async generateHTTPHeadersIntegration(
    request: CodeGenerationRequest,
    generatedCode: GeneratedCode,
  ): Promise<void> {
    const { analysisResults, selectedFeatures } = request;

    // Generate middleware or interceptor
    const middlewareFile = this.generateHTTPHeadersMiddleware(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(middlewareFile);

    // Generate configuration file
    const configFile = this.generateHTTPHeadersConfig(analysisResults);
    generatedCode.files.push(configFile);

    // Generate README
    const readmeFile = this.generateHTTPHeadersReadme(
      analysisResults,
      selectedFeatures,
    );
    generatedCode.files.push(readmeFile);

    // Update package.json if applicable
    if (
      analysisResults.language === 'javascript' ||
      analysisResults.language === 'typescript'
    ) {
      generatedCode.packageJson = this.generateHTTPHeadersPackageJson(
        analysisResults,
        selectedFeatures,
      );
    }

    // Add environment variables
    generatedCode.environmentVariables = [
      {
        name: 'COST_KATANA_API_KEY',
        description: 'API key for Cost Katana service',
        required: true,
      },
      {
        name: 'COST_KATANA_BASE_URL',
        description: 'Base URL for Cost Katana API',
        required: false,
        default: 'https://api.costkatana.com',
      },
    ];

    // Add setup instructions
    generatedCode.setupInstructions = [
      'Configure your HTTP client with the generated headers',
      'Set environment variables',
      'Test API calls with Cost Katana headers',
      'Monitor costs in your Cost Katana dashboard',
    ];
  }

  /**
   * Generate NPM main integration file
   */
  private generateNPMMainFile(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const isTypeScript = analysisResults.isTypeScriptPrimary;
    const ext = isTypeScript ? 'ts' : 'js';

    let content = '';

    if (isTypeScript) {
      content = `import { CostKatana } from 'cost-katana';

export interface CostKatanaConfig {
  apiKey: string;
  baseUrl?: string;
}

export class CostKatanaIntegration {
  private client: CostKatana;

  constructor(config: CostKatanaConfig) {
    this.client = new CostKatana({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.costkatana.com'
    });
  }

  async initialize(): Promise<void> {
    await this.client.initialize();
  }
`;

      // Add feature-specific methods
      selectedFeatures.forEach((feature) => {
        switch (feature.name) {
          case 'cost-tracking':
            content += `
  async trackAICost(model: string, tokens: number, cost: number): Promise<void> {
    await this.client.trackCost({
      model,
      tokens,
      cost,
      timestamp: new Date()
    });
  }
`;
            break;
          case 'usage-analytics':
            content += `
  async getUsageAnalytics(timeRange: string): Promise<any> {
    return await this.client.getAnalytics({
      timeRange,
      groupBy: 'model'
    });
  }
`;
            break;
          case 'budget-alerts':
            content += `
  async setBudgetAlert(budget: number, email: string): Promise<void> {
    await this.client.setBudgetAlert({
      budget,
      email,
      threshold: 0.8 // Alert at 80% of budget
    });
  }
`;
            break;
        }
      });

      content += `}
`;
    } else {
      content = `const { CostKatana } = require('cost-katana');

class CostKatanaIntegration {
  constructor(config) {
    this.client = new CostKatana({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.costkatana.com'
    });
  }

  async initialize() {
    await this.client.initialize();
  }
`;

      // Add feature-specific methods
      selectedFeatures.forEach((feature) => {
        switch (feature.name) {
          case 'cost-tracking':
            content += `
  async trackAICost(model, tokens, cost) {
    await this.client.trackCost({
      model,
      tokens,
      cost,
      timestamp: new Date()
    });
  }
`;
            break;
          case 'usage-analytics':
            content += `
  async getUsageAnalytics(timeRange) {
    return await this.client.getAnalytics({
      timeRange,
      groupBy: 'model'
    });
  }
`;
            break;
          case 'budget-alerts':
            content += `
  async setBudgetAlert(budget, email) {
    await this.client.setBudgetAlert({
      budget,
      email,
      threshold: 0.8
    });
  }
`;
            break;
        }
      });

      content += `}
`;
    }

    return {
      path: `src/cost-katana.${ext}`,
      content,
      description: 'Main Cost Katana integration module',
    };
  }

  /**
   * Generate NPM types file
   */
  private generateNPMTypesFile(
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    let content = `export interface CostKatanaConfig {
  apiKey: string;
  baseUrl?: string;
}
`;

    // Dynamically add type definitions based on selected features
    const featureNames = selectedFeatures.map((f) => f.name);

    if (featureNames.includes('cost-tracking')) {
      content += `
export interface AICostData {
  model: string;
  tokens: number;
  cost: number;
  timestamp: Date;
}
`;
    }

    if (featureNames.includes('usage-analytics')) {
      content += `
export interface UsageAnalytics {
  totalCost: number;
  totalTokens: number;
  modelsUsed: string[];
  timeRange: string;
}
`;
    }

    if (featureNames.includes('budget-alerts')) {
      content += `
export interface BudgetAlert {
  budget: number;
  email: string;
  threshold: number;
}
`;
    }

    return {
      path: 'src/types.ts',
      content,
      description: 'TypeScript type definitions',
    };
  }

  /**
   * Generate NPM README
   */
  private generateNPMReadme(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const features = selectedFeatures.map((f) => `- ${f.name}`).join('\n');

    const content = `# Cost Katana Integration

This package integrates Cost Katana AI cost optimization into your project.

## Features

${features}

## Installation

\`\`\`bash
npm install cost-katana
\`\`\`

## Usage

\`\`\`${analysisResults.isTypeScriptPrimary ? 'typescript' : 'javascript'}
import { CostKatanaIntegration } from 'cost-katana';

const integration = new CostKatanaIntegration({
  apiKey: process.env.COST_KATANA_API_KEY
});

await integration.initialize();

// Use integration methods based on selected features
\`\`\`

## Environment Variables

- \`COST_KATANA_API_KEY\`: Your Cost Katana API key
- \`COST_KATANA_BASE_URL\`: API base URL (optional)

## Documentation

For more information, visit [Cost Katana Documentation](https://docs.costkatana.com).
`;

    return {
      path: 'README.md',
      content,
      description: 'Integration documentation',
    };
  }

  /**
   * Generate package.json for NPM integration
   */
  private generatePackageJson(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): any {
    const isTypeScript = analysisResults.isTypeScriptPrimary;

    return {
      dependencies: {
        'cost-katana': '^1.0.0',
        axios: '^1.6.0',
      },
      devDependencies: isTypeScript
        ? {
            typescript: '^5.0.0',
            '@types/node': '^20.0.0',
          }
        : {},
      scripts: {
        build: isTypeScript ? 'tsc' : 'echo "No build step required"',
        test: 'echo "Add your tests here"',
      },
    };
  }

  /**
   * Generate CLI entry point
   */
  private generateCLIEntryPoint(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const isTypeScript = analysisResults.isTypeScriptPrimary;
    const ext = isTypeScript ? 'ts' : 'js';

    let content = '';

    if (isTypeScript) {
      content = `#!/usr/bin/env node

import { Command } from 'commander';
import { CostKatanaCLI } from './cli-helpers';

const program = new Command();

program
  .name('cost-katana')
  .description('Cost Katana CLI for AI cost optimization')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Cost Katana integration')
  .action(async () => {
    const cli = new CostKatanaCLI();
    await cli.initialize();
    console.log('Cost Katana integration initialized!');
  });
`;

      if (selectedFeatures.some((f) => f.name === 'cost-tracking')) {
        content += `
program
  .command('track <model> <tokens> <cost>')
  .description('Track AI usage cost')
  .action(async (model: string, tokens: string, cost: string) => {
    const cli = new CostKatanaCLI();
    await cli.trackCost(model, parseInt(tokens), parseFloat(cost));
    console.log('Cost tracked successfully!');
  });
`;
      }

      if (selectedFeatures.some((f) => f.name === 'usage-analytics')) {
        content += `
program
  .command('analytics [timeRange]')
  .description('Show usage analytics')
  .action(async (timeRange: string = '30d') => {
    const cli = new CostKatanaCLI();
    const analytics = await cli.getAnalytics(timeRange);
    console.log(JSON.stringify(analytics, null, 2));
  });
`;
      }

      content += `
program.parse();
`;
    } else {
      content = `#!/usr/bin/env node

const { Command } = require('commander');
const { CostKatanaCLI } = require('./cli-helpers');

const program = new Command();

program
  .name('cost-katana')
  .description('Cost Katana CLI for AI cost optimization')
  .version('1.0.0');

program
  .command('init')
  .description('Initialize Cost Katana integration')
  .action(async () => {
    const cli = new CostKatanaCLI();
    await cli.initialize();
    console.log('Cost Katana integration initialized!');
  });
`;

      if (selectedFeatures.some((f) => f.name === 'cost-tracking')) {
        content += `
program
  .command('track <model> <tokens> <cost>')
  .description('Track AI usage cost')
  .action(async (model, tokens, cost) => {
    const cli = new CostKatanaCLI();
    await cli.trackCost(model, parseInt(tokens), parseFloat(cost));
    console.log('Cost tracked successfully!');
  });
`;
      }

      if (selectedFeatures.some((f) => f.name === 'usage-analytics')) {
        content += `
program
  .command('analytics [timeRange]')
  .description('Show usage analytics')
  .action(async (timeRange = '30d') => {
    const cli = new CostKatanaCLI();
    const analytics = await cli.getAnalytics(timeRange);
    console.log(JSON.stringify(analytics, null, 2));
  });
`;
      }

      content += `
program.parse();
`;
    }

    return {
      path: `bin/cost-katana.${ext}`,
      content,
      description: 'CLI entry point',
    };
  }

  /**
   * Generate CLI helper functions
   */
  private generateCLIHelpers(
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const content = `const { CostKatana } = require('cost-katana');

class CostKatanaCLI {
  constructor() {
    this.client = new CostKatana({
      apiKey: process.env.COST_KATANA_API_KEY,
      baseUrl: process.env.COST_KATANA_BASE_URL || 'https://api.costkatana.com'
    });
  }

  async initialize() {
    await this.client.initialize();
  }
${
  selectedFeatures.some((f) => f.name === 'cost-tracking')
    ? `
  async trackCost(model, tokens, cost) {
    await this.client.trackCost({
      model,
      tokens,
      cost,
      timestamp: new Date()
    });
  }
`
    : ''
}
${
  selectedFeatures.some((f) => f.name === 'usage-analytics')
    ? `
  async getAnalytics(timeRange) {
    return await this.client.getAnalytics({
      timeRange,
      groupBy: 'model'
    });
  }
`
    : ''
}
}

module.exports = { CostKatanaCLI };
`;

    return {
      path: 'lib/cli-helpers.js',
      content,
      description: 'CLI helper functions',
    };
  }

  /**
   * Generate CLI README
   */
  private generateCLIReadme(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const content = `# Cost Katana CLI

Command-line interface for Cost Katana AI cost optimization.

## Installation

\`\`\`bash
npm install -g cost-katana-cli
\`\`\`

## Commands

- \`cost-katana init\` - Initialize Cost Katana integration
${selectedFeatures.some((f) => f.name === 'cost-tracking') ? '- `cost-katana track <model> <tokens> <cost>` - Track AI usage cost' : ''}
${selectedFeatures.some((f) => f.name === 'usage-analytics') ? '- `cost-katana analytics [timeRange]` - Show usage analytics' : ''}

## Environment Variables

- \`COST_KATANA_API_KEY\` - Your Cost Katana API key
- \`COST_KATANA_BASE_URL\` - API base URL (optional)
`;

    return {
      path: 'README.md',
      content,
      description: 'CLI documentation',
    };
  }

  /**
   * Generate CLI package.json
   */
  private generateCLIPackageJson(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): any {
    const isTypeScript = analysisResults.isTypeScriptPrimary;

    return {
      dependencies: {
        'cost-katana': '^1.0.0',
        commander: '^11.0.0',
        axios: '^1.6.0',
      },
      devDependencies: isTypeScript
        ? {
            typescript: '^5.0.0',
            '@types/node': '^20.0.0',
          }
        : {},
      scripts: {
        build: isTypeScript ? 'tsc' : 'echo "No build step required"',
        test: 'echo "Add your tests here"',
      },
      bin: {
        'cost-katana': 'bin/cost-katana.js',
      },
    };
  }

  /**
   * Generate Python main module
   */
  private generatePythonMainModule(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    // Analyze analysisResults for type imports and Python version usage
    const mainModuleName =
      analysisResults.pythonMainModuleName || 'cost_katana_integration';
    const clientImport = analysisResults.pythonSDKImportName || 'cost_katana';

    let content = `"""Cost Katana Python Integration"""

import os
from typing import Optional${selectedFeatures.some((f) => f.name === 'usage-analytics') ? ', Dict, Any' : ''}${selectedFeatures.some((f) => f.name === 'cost-tracking') ? '\nfrom datetime import datetime' : ''}
from ${clientImport} import CostKatana

class CostKatanaIntegration:
    \"\"\"Main Cost Katana integration class\"\"\"

    def __init__(self, api_key: str, base_url: Optional[str] = None):
        self.client = CostKatana(
            api_key=api_key,
            base_url=base_url or "https://api.costkatana.com"
        )

    async def initialize(self) -> None:
        \"\"\"Initialize the Cost Katana client\"\"\"
        await self.client.initialize()
`;

    // Add feature-specific methods with typing if appropriate
    selectedFeatures.forEach((feature) => {
      switch (feature.name) {
        case 'cost-tracking':
          content += `
    async def track_ai_cost(self, model: str, tokens: int, cost: float) -> None:
        \"\"\"Track AI usage cost\"\"\"
        await self.client.track_cost({
            "model": model,
            "tokens": tokens,
            "cost": cost,
            "timestamp": datetime.now()
        })
`;
          break;
        case 'usage-analytics':
          content += `
    async def get_usage_analytics(self, time_range: str = "30d") -> Dict[str, Any]:
        \"\"\"Get usage analytics\"\"\"
        return await self.client.get_analytics({
            "time_range": time_range,
            "group_by": "model"
        })
`;
          break;
        case 'budget-alerts':
          content += `
    async def set_budget_alert(self, budget: float, email: str) -> None:
        \"\"\"Set budget alert\"\"\"
        await self.client.set_budget_alert({
            "budget": budget,
            "email": email,
            "threshold": 0.8
        })
`;
          break;
      }
    });

    content += `
# Convenience function for easy initialization
def create_integration(
    api_key: Optional[str] = None,
    base_url: Optional[str] = None
) -> CostKatanaIntegration:
    \"\"\"Create Cost Katana integration instance\"\"\"
    api_key = api_key or os.getenv("COST_KATANA_API_KEY")
    if not api_key:
        raise ValueError("API key must be provided or set in COST_KATANA_API_KEY environment variable")

    base_url = base_url or os.getenv("COST_KATANA_BASE_URL")
    return CostKatanaIntegration(api_key, base_url)
`;

    return {
      path: `${mainModuleName}.py`,
      content,
      description: 'Main Python integration module',
    };
  }

  /**
   * Generate Python __init__.py
   */
  private generatePythonInitFile(): GeneratedCode['files'][0] {
    const content = `"""Cost Katana Integration Package"""

from .cost_katana_integration import CostKatanaIntegration, create_integration

__version__ = "1.0.0"
__all__ = ["CostKatanaIntegration", "create_integration"]
`;

    return {
      path: '__init__.py',
      content,
      description: 'Python package initialization',
    };
  }

  /**
   * Generate Python README
   */
  private generatePythonReadme(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const features = selectedFeatures.map((f) => `- ${f.name}`).join('\n');

    // Optionally include more detailed project/language context using analysisResults
    const pythonVersion = analysisResults.languageDetails?.pythonVersion
      ? ` (Python ${analysisResults.languageDetails.pythonVersion})`
      : '';
    const detectedFramework = analysisResults.framework
      ? `\n\nDetected framework: ${analysisResults.framework}`
      : '';

    const content = `# Cost Katana Python Integration${pythonVersion}

Python package for integrating Cost Katana AI cost optimization.${detectedFramework}

## Features

${features}

## Installation

\`\`\`bash
pip install -r requirements.txt
\`\`\`

## Usage

\`\`\`python
from cost_katana_integration import create_integration

# Initialize integration
integration = create_integration()
await integration.initialize()

# Use integration methods based on selected features
\`\`\`

## Environment Variables

- \`COST_KATANA_API_KEY\` - Your Cost Katana API key
- \`COST_KATANA_BASE_URL\` - API base URL (optional)
`;

    return {
      path: 'README.md',
      content,
      description: 'Python integration documentation',
    };
  }

  /**
   * Generate HTTP headers middleware
   */
  private generateHTTPHeadersMiddleware(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    const language = analysisResults.language;
    let content = '';
    let path = '';
    let ext = '';

    if (language === 'javascript' || language === 'typescript') {
      ext = analysisResults.isTypeScriptPrimary ? 'ts' : 'js';
      path = `middleware/cost-katana.${ext}`;

      if (analysisResults.isTypeScriptPrimary) {
        content = `import { NextRequest, NextResponse } from 'next/server';

export function costKatanaMiddleware(request: NextRequest): NextResponse {
  const response = NextResponse.next();

  // Add Cost Katana headers
  response.headers.set('X-Cost-Katana-API-Key', process.env.COST_KATANA_API_KEY || '');
  response.headers.set('X-Cost-Katana-Version', '1.0.0');
  response.headers.set('X-Cost-Katana-Request-ID', generateRequestId());

  // Add feature-specific headers
  ${selectedFeatures
    .map((feature) => {
      switch (feature.name) {
        case 'cost-tracking':
          return `response.headers.set('X-Cost-Katana-Track-Cost', 'true');`;
        case 'usage-analytics':
          return `response.headers.set('X-Cost-Katana-Analytics', 'true');`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n  ')}

  return response;
}

function generateRequestId(): string {
  return \`req_\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;
}
`;
      } else {
        content = `function costKatanaMiddleware(req, res, next) {
  // Add Cost Katana headers
  res.setHeader('X-Cost-Katana-API-Key', process.env.COST_KATANA_API_KEY || '');
  res.setHeader('X-Cost-Katana-Version', '1.0.0');
  res.setHeader('X-Cost-Katana-Request-ID', generateRequestId());

  // Add feature-specific headers
  ${selectedFeatures
    .map((feature) => {
      switch (feature.name) {
        case 'cost-tracking':
          return `res.setHeader('X-Cost-Katana-Track-Cost', 'true');`;
        case 'usage-analytics':
          return `res.setHeader('X-Cost-Katana-Analytics', 'true');`;
        default:
          return '';
      }
    })
    .filter(Boolean)
    .join('\n  ')}

  next();
}

function generateRequestId() {
  return \`req_\${Date.now()}_\${Math.random().toString(36).substr(2, 9)}\`;
}

module.exports = { costKatanaMiddleware };
`;
      }
    } else if (language === 'python') {
      path = 'middleware/cost_katana.py';
      content = `"""Cost Katana HTTP Headers Middleware"""

import os
from typing import Dict, Any
import uuid
from datetime import datetime

class CostKatanaMiddleware:
    """Middleware to add Cost Katana headers to HTTP requests"""

    def __init__(self):
        self.api_key = os.getenv("COST_KATANA_API_KEY", "")

    def process_request(self, request: Dict[str, Any]) -> Dict[str, Any]:
        """Process incoming request and add Cost Katana headers"""
        headers = request.get('headers', {})

        # Add Cost Katana headers
        headers['X-Cost-Katana-API-Key'] = self.api_key
        headers['X-Cost-Katana-Version'] = '1.0.0'
        headers['X-Cost-Katana-Request-ID'] = self._generate_request_id()

        # Add feature-specific headers
        ${selectedFeatures
          .map((feature) => {
            switch (feature.name) {
              case 'cost-tracking':
                return `headers['X-Cost-Katana-Track-Cost'] = 'true'`;
              case 'usage-analytics':
                return `headers['X-Cost-Katana-Analytics'] = 'true'`;
              default:
                return '';
            }
          })
          .filter(Boolean)
          .join('\n        ')}

        request['headers'] = headers
        return request

    def _generate_request_id(self) -> str:
        """Generate unique request ID"""
        return f"req_{int(datetime.now().timestamp())}_{str(uuid.uuid4())[:8]}"
`;
    }

    return {
      path,
      content,
      description: 'HTTP headers middleware for Cost Katana integration',
    };
  }

  /**
   * Generate HTTP headers config
   */
  private generateHTTPHeadersConfig(
    analysisResults: AnalysisResult,
  ): GeneratedCode['files'][0] {
    const language = analysisResults.language;
    let content = '';
    let path = '';

    if (language === 'javascript' || language === 'typescript') {
      const ext = analysisResults.isTypeScriptPrimary ? 'ts' : 'js';
      path = `config/cost-katana.${ext}`;

      if (analysisResults.isTypeScriptPrimary) {
        content = `export const COST_KATANA_CONFIG = {
  apiKey: process.env.COST_KATANA_API_KEY || '',
  baseUrl: process.env.COST_KATANA_BASE_URL || 'https://api.costkatana.com',
  headers: {
    'X-Cost-Katana-API-Key': process.env.COST_KATANA_API_KEY || '',
    'X-Cost-Katana-Version': '1.0.0',
    'Content-Type': 'application/json'
  }
};
`;
      } else {
        content = `const COST_KATANA_CONFIG = {
  apiKey: process.env.COST_KATANA_API_KEY || '',
  baseUrl: process.env.COST_KATANA_BASE_URL || 'https://api.costkatana.com',
  headers: {
    'X-Cost-Katana-API-Key': process.env.COST_KATANA_API_KEY || '',
    'X-Cost-Katana-Version': '1.0.0',
    'Content-Type': 'application/json'
  }
};

module.exports = { COST_KATANA_CONFIG };
`;
      }
    } else if (language === 'python') {
      path = 'config/cost_katana.py';
      content = `"""Cost Katana Configuration"""

import os

COST_KATANA_CONFIG = {
    "api_key": os.getenv("COST_KATANA_API_KEY", ""),
    "base_url": os.getenv("COST_KATANA_BASE_URL", "https://api.costkatana.com"),
    "headers": {
        "X-Cost-Katana-API-Key": os.getenv("COST_KATANA_API_KEY", ""),
        "X-Cost-Katana-Version": "1.0.0",
        "Content-Type": "application/json"
    }
}
`;
    }

    return {
      path,
      content,
      description: 'Cost Katana configuration file',
    };
  }

  /**
   * Generate HTTP headers README
   */
  private generateHTTPHeadersReadme(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): GeneratedCode['files'][0] {
    // Use analysisResults properties to enhance the README content
    const {
      projectName,
      language,
      detectedFramework,
      description: projectDescription,
    } = analysisResults;

    const introSection = [
      `# Cost Katana HTTP Headers Integration`,
      projectName ? `\n**Project**: ${projectName}` : '',
      projectDescription ? `\n${projectDescription}` : '',
      '\nIntegrate Cost Katana AI cost optimization via HTTP headers.',
      detectedFramework
        ? `\n\nDetected framework: **${detectedFramework}**`
        : '',
      language ? `\n\nPrimary language: **${language}**` : '',
    ]
      .filter(Boolean)
      .join('');

    const content = `${introSection}

## Setup

1. Configure your HTTP client to include Cost Katana headers
2. Set environment variables
3. Make API calls with the configured headers

## Required Headers

- \`X-Cost-Katana-API-Key\`: Your Cost Katana API key
- \`X-Cost-Katana-Version\`: Integration version
- \`X-Cost-Katana-Request-ID\`: Unique request identifier

## Environment Variables

- \`COST_KATANA_API_KEY\` - Your Cost Katana API key
- \`COST_KATANA_BASE_URL\` - API base URL (optional)

${language ? `\n## Example (${language}):\n\nSee the generated configuration file for a starter template.` : ''}

## Features Enabled

${selectedFeatures.map((f) => `- ${f.name}`).join('\n')}
`;

    return {
      path: 'README.md',
      content,
      description: 'HTTP headers integration documentation',
    };
  }

  /**
   * Generate HTTP headers package.json
   */
  private generateHTTPHeadersPackageJson(
    analysisResults: AnalysisResult,
    selectedFeatures: IFeatureConfig[],
  ): any {
    const isTypeScript = analysisResults.isTypeScriptPrimary;

    // Process selectedFeatures to add optional dependencies (future extension)
    // For now, demonstrate usage by optionally adding dependencies for known features
    const additionalDependencies: Record<string, string> = {};
    const additionalDevDependencies: Record<string, string> = {};

    selectedFeatures.forEach((feature) => {
      // Example: If a logging or monitoring feature is enabled, add relevant package
      if (feature.name.toLowerCase().includes('logging')) {
        additionalDependencies['winston'] = '^3.8.2';
      }
      if (feature.name.toLowerCase().includes('request tracing')) {
        additionalDependencies['uuid'] = '^9.0.0';
      }
      // You can add more feature-package mappings here as needed
    });

    return {
      dependencies: {
        'cost-katana': '^1.0.0',
        ...additionalDependencies,
      },
      devDependencies: isTypeScript
        ? {
            typescript: '^5.0.0',
            '@types/node': '^20.0.0',
            ...additionalDevDependencies,
          }
        : {
            ...additionalDevDependencies,
          },
      scripts: {
        build: isTypeScript ? 'tsc' : 'echo "No build step required"',
        test: 'echo "Add your tests here"',
      },
    };
  }
}
