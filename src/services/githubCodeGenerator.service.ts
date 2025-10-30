import { TracedBedrockService as BedrockService } from './tracedBedrock.service';
import { AnalysisResult } from './githubAnalysis.service';
import { loggingService } from './logging.service';
import { IFeatureConfig } from '../models';
import { retrievalService } from './retrieval.service';

export interface GeneratedFile {
    path: string;
    content: string;
    description: string;
}

export interface IntegrationCode {
    files: GeneratedFile[];
    envVars: Record<string, string>;
    installCommands: string[];
    setupInstructions: string;
    testingSteps: string[];
}

export interface CodeGenerationOptions {
    integrationType: 'npm' | 'cli' | 'python';
    features: IFeatureConfig[];
    analysis: AnalysisResult;
    repositoryName: string;
    apiKey: string;
}

export class GitHubCodeGeneratorService {
    /**
     * Generate integration code based on repository analysis and selected features
     */
    static async generateIntegrationCode(
        userId: string,
        options: CodeGenerationOptions
    ): Promise<IntegrationCode> {
        try {
            loggingService.info('Starting code generation', {
                userId,
                integrationType: options.integrationType,
                features: options.features.map(f => f.name),
                language: options.analysis.language
            });

            // Retrieve relevant integration guides from knowledge base
            const context = await this.getIntegrationContext(
                options.integrationType,
                options.features
            );

            // Generate code based on integration type
            let integrationCode: IntegrationCode;

            switch (options.integrationType) {
                case 'npm':
                    integrationCode = await this.generateNPMIntegration(userId, options, context);
                    break;
                case 'cli':
                    integrationCode = await this.generateCLIIntegration(userId, options, context);
                    break;
                case 'python':
                    integrationCode = await this.generatePythonIntegration(userId, options, context);
                    break;
                default:
                    throw new Error(`Unsupported integration type: ${options.integrationType}`);
            }

            loggingService.info('Code generation completed', {
                userId,
                filesGenerated: integrationCode.files.length,
                envVarsCount: Object.keys(integrationCode.envVars).length
            });

            return integrationCode;
        } catch (error: any) {
            loggingService.error('Code generation failed', {
                userId,
                error: error.message,
                stack: error.stack
            });
            throw error;
        }
    }

    /**
     * Get integration context from knowledge base
     */
    private static async getIntegrationContext(
        integrationType: string,
        features: IFeatureConfig[]
    ): Promise<string> {
        try {
            const queries = [
                `${integrationType} integration guide`,
                'CostKatana setup instructions',
                ...features.map((f: IFeatureConfig) => `CostKatana ${f.name} feature`)
            ];

            // Use retrievalService to get relevant context from knowledge base
            const retrievalResults = await Promise.all(
                queries.map((query: string) => retrievalService.retrieveKnowledgeBase(query, 3))
            );

            // Build context from retrieved documents
            let context = `Integration guides for ${integrationType}:\n\n`;
            
            // Add retrieved knowledge base content
            retrievalResults.forEach((retrievalResult: any, index: number) => {
                if (retrievalResult.results && retrievalResult.results.length > 0) {
                    context += `## ${queries[index]}\n`;
                    retrievalResult.results.forEach((doc: any) => {
                        context += `${doc.content || doc.text || ''}\n\n`;
                    });
                }
            });
            
            // Add feature-specific context
            context += `Selected features:\n`;
            context += features.map((f: IFeatureConfig) => `- ${f.name}`).join('\n');
            context += '\n\n';

            loggingService.info('Retrieved integration context from knowledge base', {
                integrationType,
                queriesCount: queries.length,
                featuresCount: features.length,
                documentsRetrieved: retrievalResults.flat().length
            });

            return context;
        } catch (error: any) {
            loggingService.warn('Failed to retrieve knowledge base context', {
                error: error.message
            });
            
            // Fallback to basic context if retrieval fails
            let fallbackContext = `Integration guides for ${integrationType}:\n\n`;
            fallbackContext += `Selected features:\n`;
            fallbackContext += features.map((f: IFeatureConfig) => `- ${f.name}`).join('\n');
            fallbackContext += '\n\nRefer to documentation for detailed implementation patterns.';
            
            return fallbackContext;
        }
    }

    /**
     * Generate NPM package integration
     */
    private static async generateNPMIntegration(
        userId: string,
        options: CodeGenerationOptions,
        context: string
    ): Promise<IntegrationCode> {
        const { analysis, features, repositoryName, apiKey } = options;

        const prompt = `You are an expert software engineer helping integrate CostKatana (cost-katana npm package) into a ${analysis.language} project.

Repository: ${repositoryName}

Repository Analysis:
- Language: ${analysis.language}
- Framework: ${analysis.framework ?? 'None detected'}
- Project Type: ${analysis.projectType}
- Entry Points: ${analysis.entryPoints.join(', ')}
- Existing AI Integrations: ${analysis.existingAIIntegrations.join(', ') ?? 'None'}
- Package Manager: ${analysis.packageManager ?? 'npm'}

Selected Features:
${features.map(f => `- ${f.name}${f.config ? ': ' + JSON.stringify(f.config) : ''}`).join('\n')}

Integration Context:
${context}

Your task:
1. Generate a complete integration file that wraps CostKatana initialization and exports a configured instance
2. Update the main entry point (${analysis.entryPoints[0] || 'src/index.js'}) to import and use CostKatana
3. Create a comprehensive .env.example with all required CostKatana variables
4. Generate a detailed setup guide (COSTKATANA_SETUP.md)

Requirements:
- Use modern ES6/TypeScript syntax
- Follow the project's existing patterns (detected: ${(analysis.detectedPatterns && analysis.detectedPatterns.length > 0) ? analysis.detectedPatterns.join(', ') : 'standard patterns'})
- Include error handling and logging
- Add TypeScript types if project uses TypeScript
- Generate production-ready, well-documented code
- Include example usage for each selected feature

Return a JSON object with this exact structure:
{
  "files": [
    {
      "path": "src/costkatana.${analysis.language === 'typescript' ? 'ts' : 'js'}",
      "content": "// file content here",
      "description": "CostKatana configuration and initialization"
    }
  ],
  "envVars": {
    "COSTKATANA_API_KEY": "Your CostKatana API key",
    "COSTKATANA_DEFAULT_MODEL": "amazon.nova-lite-v1:0"
  },
  "installCommands": ["${analysis.packageManager ?? 'npm'} install cost-katana"],
  "setupInstructions": "Detailed markdown instructions",
  "testingSteps": ["Step 1", "Step 2"]
}`;

        const response = await BedrockService.invokeModel(
            prompt,
            'anthropic.claude-3-5-sonnet-20240620-v1:0', // Use Claude for complex code generation
            { useSystemPrompt: false }
        ) as string;

        // Parse AI response
        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid AI response format');
            }
            
            const result = JSON.parse(jsonMatch[0]) as IntegrationCode;
            
            // Replace placeholder API key with actual key
            result.files.forEach(file => {
                file.content = file.content.replace(/your-costkatana-api-key/gi, apiKey);
                file.content = file.content.replace(/YOUR_API_KEY_HERE/gi, apiKey);
            });

            // Ensure env vars include the actual API key
            result.envVars['COSTKATANA_API_KEY'] = apiKey;

            return result;
        } catch (parseError: unknown) {
            const error = parseError as Error;
            loggingService.error('Failed to parse AI code generation response', {
                userId,
                error: error.message,
                response: response.substring(0, 500)
            });
            
            // Fallback to template-based generation
            return this.generateNPMTemplate(options, apiKey);
        }
    }

    /**
     * Generate CLI integration
     */
    private static async generateCLIIntegration(
        userId: string,
        options: CodeGenerationOptions,
        context: string
    ): Promise<IntegrationCode> {
        const { analysis, features, apiKey } = options;

        const prompt = `You are an expert helping integrate CostKatana CLI (cost-katana-cli) into a ${analysis.language} project.

Repository Analysis:
- Language: ${analysis.language}
- Framework: ${analysis.framework ?? 'None detected'}
- Has CI/CD: ${analysis.hasCI ? 'Yes' : 'No'}

Selected Features:
${features.map(f => `- ${f.name}`).join('\n')}

Integration Context:
${context}

Generate:
1. CLI configuration file (.costkatanarc.json)
2. NPM scripts for common CLI operations
3. CI/CD integration examples (if applicable)
4. Setup guide

Return JSON with files, envVars, installCommands, setupInstructions, and testingSteps.`;

        const response = await BedrockService.invokeModel(
            prompt,
            'amazon.nova-pro-v1:0',
            { useSystemPrompt: false }
        ) as string;

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid AI response format');
            }
            return JSON.parse(jsonMatch[0]) as IntegrationCode;
        } catch (error) {
            return this.generateCLITemplate(options, apiKey);
        }
    }

    /**
     * Generate Python SDK integration
     */
    private static async generatePythonIntegration(
        userId: string,
        options: CodeGenerationOptions,
        context: string
    ): Promise<IntegrationCode> {
        const { analysis, features, apiKey } = options;

        const prompt = `You are an expert helping integrate CostKatana Python SDK (cost-katana) into a Python project.

Repository Analysis:
- Framework: ${analysis.framework ?? 'Python'}
- Entry Points: ${analysis.entryPoints.join(', ')}
- Existing AI Integrations: ${analysis.existingAIIntegrations.join(', ') ?? 'None'}
- Package Manager: ${analysis.packageManager ?? 'pip'}

Selected Features:
${features.map(f => `- ${f.name}`).join('\n')}

Integration Context:
${context}

Generate:
1. CostKatana configuration module (costkatana_config.py)
2. Updated main entry point with integration
3. requirements.txt additions
4. Setup guide with examples

Return JSON with files, envVars, installCommands, setupInstructions, and testingSteps.`;

        const response = await BedrockService.invokeModel(
            prompt,
            'anthropic.claude-3-5-sonnet-20240620-v1:0',
            { useSystemPrompt: false }
        ) as string;

        try {
            const jsonMatch = response.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid AI response format');
            }
            return JSON.parse(jsonMatch[0]) as IntegrationCode;
        } catch (error) {
            return this.generatePythonTemplate(options, apiKey);
        }
    }

    /**
     * Fallback NPM template
     */
    private static generateNPMTemplate(
        options: CodeGenerationOptions,
        apiKey: string
    ): IntegrationCode {
        const { analysis } = options;
        const isTypeScript = analysis.language === 'typescript';
        const ext = isTypeScript ? 'ts' : 'js';

        const configFile = `${isTypeScript ? "import { ai } from 'cost-katana';\n\n" : "const { ai } = require('cost-katana');\n\n"}// Initialize CostKatana
// Example usage
const response = await ai('gpt-4', 'Hello, world!');
console.log(response.text);
console.log(\`Cost: \${response.cost}\`);

${isTypeScript ? 'export { ai };' : 'module.exports = { ai };'}
`;

        return {
            files: [
                {
                    path: `src/costkatana.${ext}`,
                    content: configFile,
                    description: 'CostKatana configuration and initialization'
                },
                {
                    path: '.env.example',
                    content: `COSTKATANA_API_KEY=${apiKey}\nCOSTKATANA_DEFAULT_MODEL=amazon.nova-lite-v1:0\n`,
                    description: 'Environment variables template'
                }
            ],
            envVars: {
                'COSTKATANA_API_KEY': apiKey,
                'COSTKATANA_DEFAULT_MODEL': 'amazon.nova-lite-v1:0'
            },
            installCommands: [`${analysis.packageManager || 'npm'} install cost-katana`],
            setupInstructions: '# CostKatana Setup\n\n1. Install the package\n2. Configure environment variables\n3. Import and use the tracker',
            testingSteps: [
                'Run npm install to install dependencies',
                'Copy .env.example to .env and add your API key',
                'Import tracker in your code',
                'Test with a simple AI request'
            ]
        };
    }

    /**
     * Fallback CLI template
     */
    private static generateCLITemplate(
        options: CodeGenerationOptions,
        apiKey: string
    ): IntegrationCode {
        const config = {
            apiKey: apiKey,
            defaultModel: 'amazon.nova-lite-v1:0',
            projectName: options.repositoryName
        };

        return {
            files: [
                {
                    path: '.costkatanarc.json',
                    content: JSON.stringify(config, null, 2),
                    description: 'CostKatana CLI configuration'
                }
            ],
            envVars: {
                'COSTKATANA_API_KEY': apiKey
            },
            installCommands: ['npm install -g cost-katana-cli'],
            setupInstructions: '# CostKatana CLI Setup\n\n1. Install CLI globally\n2. Run cost-katana init\n3. Use CLI commands',
            testingSteps: [
                'Install CLI: npm install -g cost-katana-cli',
                'Test: cost-katana --version',
                'Run: cost-katana chat'
            ]
        };
    }

    /**
     * Fallback Python template
     */
    private static generatePythonTemplate(
        options: CodeGenerationOptions,
        apiKey: string
    ): IntegrationCode {
        const configFile = `"""CostKatana configuration module."""
import cost_katana as ck
import os

# Configure CostKatana
ck.configure(
    api_key=os.getenv('COSTKATANA_API_KEY', '${apiKey}'),
    default_model='nova-lite',
    cost_limit_per_day=50.0
)

# Create model instance
model = ck.GenerativeModel('nova-lite')

def get_model():
    """Get configured CostKatana model instance."""
    return model
`;

        return {
            files: [
                {
                    path: 'costkatana_config.py',
                    content: configFile,
                    description: 'CostKatana configuration module'
                },
                {
                    path: '.env.example',
                    content: `COSTKATANA_API_KEY=${apiKey}\n`,
                    description: 'Environment variables template'
                }
            ],
            envVars: {
                'COSTKATANA_API_KEY': apiKey
            },
            installCommands: ['pip install cost-katana'],
            setupInstructions: '# CostKatana Python Setup\n\n1. Install package\n2. Configure environment\n3. Import and use',
            testingSteps: [
                'Install: pip install cost-katana',
                'Import: from costkatana_config import model',
                'Test: response = model.generate_content("Hello")'
            ]
        };
    }
}

export default GitHubCodeGeneratorService;



