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
    integrationType: 'npm' | 'cli' | 'python' | 'http-headers';
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
        const startTime = Date.now();
        try {
            loggingService.info('Starting code generation', {
                userId,
                integrationType: options.integrationType,
                features: options.features.map(f => f.name),
                language: options.analysis.language,
                timestamp: new Date().toISOString()
            });

            // Retrieve relevant integration guides from knowledge base
            loggingService.info('Retrieving integration context from knowledge base', {
                userId,
                integrationType: options.integrationType,
                featureCount: options.features.length
            });
            
            const context = await this.getIntegrationContext(
                options.integrationType,
                options.features
            );

            loggingService.info('Integration context retrieved', {
                userId,
                contextLength: context.length,
                timestamp: new Date().toISOString()
            });

            // Generate code based on integration type
            let integrationCode: IntegrationCode;

            loggingService.info('Starting code generation for integration type', {
                userId,
                integrationType: options.integrationType,
                timestamp: new Date().toISOString()
            });

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
                case 'http-headers':
                    integrationCode = await this.generateHTTPHeadersIntegration(userId, options, context);
                    break;
                default:
                    throw new Error(`Unsupported integration type: ${options.integrationType}`);
            }

            const elapsed = Date.now() - startTime;
            loggingService.info('Code generation completed', {
                userId,
                filesGenerated: integrationCode.files.length,
                envVarsCount: Object.keys(integrationCode.envVars).length,
                elapsedMs: elapsed,
                timestamp: new Date().toISOString()
            });

            return integrationCode;
        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            loggingService.error('Code generation failed', {
                userId,
                error: error.message,
                stack: error.stack,
                elapsedMs: elapsed,
                timestamp: new Date().toISOString()
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
     * Fix unescaped newlines and special characters in JSON string values
     */
    private static fixJsonStringEscaping(json: string): string {
        let result = '';
        let inString = false;
        let escaped = false;
        let i = 0;
        
        while (i < json.length) {
            const char = json[i];
            
            if (escaped) {
                result += char;
                escaped = false;
                i++;
                continue;
            }
            
            if (char === '\\') {
                result += char;
                escaped = true;
                i++;
                continue;
            }
            
            if (char === '"') {
                inString = !inString;
                result += char;
                i++;
                continue;
            }
            
            if (inString) {
                // Escape special characters within strings
                if (char === '\n') {
                    result += '\\n';
                } else if (char === '\r') {
                    result += '\\r';
                } else if (char === '\t') {
                    result += '\\t';
                } else {
                    result += char;
                }
            } else {
                result += char;
            }
            
            i++;
        }
        
        return result;
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
2. Update the main entry point (${analysis.entryPoints[0] || (analysis.language === 'typescript' ? 'src/index.ts' : 'src/index.js')}) to import and use CostKatana
3. Create a comprehensive .env.example with all required CostKatana variables
4. Generate a detailed setup guide (COSTKATANA_SETUP.md)

Requirements:
- Use modern ES6/TypeScript syntax
- Follow the project's existing patterns (detected: ${(analysis.detectedPatterns && analysis.detectedPatterns.length > 0) ? analysis.detectedPatterns.join(', ') : 'standard patterns'})
- Include error handling and logging
- Add TypeScript types if project uses TypeScript
- Generate production-ready, well-documented code
- Include example usage for each selected feature
- CRITICAL: For TypeScript projects (language is 'typescript'), ONLY generate .ts files. Do NOT generate .js files.
- CRITICAL: The entry point file extension must match the project language (TypeScript = .ts, JavaScript = .js)
- CRITICAL: Only generate source files, never generate files in dist/, build/, or other output directories

Return a JSON object with this exact structure:
{
  "files": [
    {
      "path": "src/costkatana.${analysis.language === 'typescript' ? 'ts' : 'js'}",
      "content": "// file content here",
      "description": "CostKatana configuration and initialization"
    },
    {
      "path": "${analysis.entryPoints[0]?.replace(/\.js$/, analysis.language === 'typescript' ? '.ts' : '.js') || (analysis.language === 'typescript' ? 'src/index.ts' : 'src/index.js')}",
      "content": "// updated entry point with CostKatana import",
      "description": "Main entry point updated with CostKatana integration"
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

        // Add timeout wrapper for code generation (5 minutes max)
        const CODE_GENERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        loggingService.info('Calling Claude Opus 4.1 for code generation', {
            userId,
            integrationType: 'npm',
            promptLength: prompt.length,
            timestamp: new Date().toISOString()
        });
        
        let response: string;
        const startTime = Date.now();
        try {
            response = await Promise.race([
                BedrockService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0', // Use Claude Opus 4.1 for complex code generation
                    { useSystemPrompt: false }
                ) as Promise<string>,
                new Promise<string>((_, reject) => 
                    setTimeout(() => {
                        const elapsed = Date.now() - startTime;
                        loggingService.error('Code generation timeout', {
                            userId,
                            elapsedMs: elapsed,
                            timeout: CODE_GENERATION_TIMEOUT
                        });
                        reject(new Error('Code generation timeout after 5 minutes'));
                    }, CODE_GENERATION_TIMEOUT)
                )
            ]);
            
            const elapsed = Date.now() - startTime;
            loggingService.info('Claude Opus 4.1 response received', {
                userId,
                elapsedMs: elapsed,
                responseLength: response?.length ?? 0
            });
        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            // Fallback to Claude 3.5 Sonnet if Opus 4.1 fails or times out
            loggingService.warn('Claude Opus 4.1 failed, falling back to Claude 3.5 Sonnet', {
                userId,
                error: error.message,
                errorStack: error.stack,
                elapsedMs: elapsed,
                willRetry: true
            });
            
            const fallbackStartTime = Date.now();
            try {
                response = await Promise.race([
                    BedrockService.invokeModel(
                        prompt,
                        'anthropic.claude-3-5-sonnet-20240620-v1:0', // Fallback to Claude 3.5 Sonnet
                        { useSystemPrompt: false }
                    ) as Promise<string>,
                    new Promise<string>((_, reject) => {
                        setTimeout(() => {
                            const fallbackElapsed = Date.now() - fallbackStartTime;
                            loggingService.error('Fallback code generation timeout', {
                                userId,
                                elapsedMs: fallbackElapsed,
                                timeout: CODE_GENERATION_TIMEOUT
                            });
                            reject(new Error('Code generation timeout after 5 minutes (fallback)'));
                        }, CODE_GENERATION_TIMEOUT);
                    })
                ]);
                
                const fallbackElapsed = Date.now() - fallbackStartTime;
                loggingService.info('Claude 3.5 Sonnet fallback response received', {
                    userId,
                    elapsedMs: fallbackElapsed,
                    responseLength: response?.length ?? 0
                });
            } catch (fallbackError: any) {
                const fallbackElapsed = Date.now() - fallbackStartTime;
                loggingService.error('Both Claude models failed, using template fallback', {
                    userId,
                    opusError: error.message,
                    opusStack: error.stack,
                    sonnetError: fallbackError.message,
                    sonnetStack: fallbackError.stack,
                    opusElapsedMs: elapsed,
                    sonnetElapsedMs: fallbackElapsed
                });
                // Final fallback to template
                return this.generateNPMTemplate(options, apiKey);
            }
        }

        if (!response || typeof response !== 'string') {
            loggingService.error('Invalid response from AI model', {
                userId,
                responseType: typeof response,
                responseLength: response?.length
            });
            return this.generateNPMTemplate(options, apiKey);
        }

        // Parse AI response with robust handling of malformed JSON
        try {
            // Try to find JSON in the response, handling code blocks
            let jsonStr = response;
            
            // Remove markdown code blocks if present
            jsonStr = jsonStr.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            // Find JSON object (handle multiline)
            const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid AI response format - no JSON found');
            }
            
            let jsonContent = jsonMatch[0];
            
            // Fix unescaped newlines in JSON strings using a state machine approach
            // This properly handles multiline strings in JSON
            const fixJsonStrings = (json: string): string => {
                let result = '';
                let inString = false;
                let escaped = false;
                let i = 0;
                
                while (i < json.length) {
                    const char = json[i];
                    
                    if (escaped) {
                        result += char;
                        escaped = false;
                        i++;
                        continue;
                    }
                    
                    if (char === '\\') {
                        result += char;
                        escaped = true;
                        i++;
                        continue;
                    }
                    
                    if (char === '"') {
                        inString = !inString;
                        result += char;
                        i++;
                        continue;
                    }
                    
                    if (inString) {
                        // We're inside a string - escape control characters
                        if (char === '\n') {
                            result += '\\n';
                        } else if (char === '\r') {
                            result += '\\r';
                        } else if (char === '\t') {
                            result += '\\t';
                        } else {
                            result += char;
                        }
                    } else {
                        result += char;
                    }
                    
                    i++;
                }
                
                return result;
            };
            
            // Apply the fix
            jsonContent = fixJsonStrings(jsonContent);
            
            // Try parsing
            let result: IntegrationCode;
            try {
                result = JSON.parse(jsonContent) as IntegrationCode;
            } catch (parseErr: any) {
                loggingService.warn('JSON parsing failed, trying alternative fix method', {
                    userId,
                    error: parseErr.message,
                    errorPosition: parseErr.message?.match(/position (\d+)/)?.[1]
                });
                
                // Alternative fix: use regex-based approach as fallback
                // This handles cases where the state machine might miss something
                jsonContent = jsonMatch[0]; // Reset to original
                jsonContent = jsonContent.replace(
                    /"content"\s*:\s*"((?:[^"\\]|\\.|\\n)*)"/g,
                    (match, content) => {
                        // If content has actual newlines (not \n), escape them
                        if (content.includes('\n')) {
                            const fixed = content
                                .replace(/\\/g, '\\\\')  // Escape existing backslashes first
                                .replace(/\n/g, '\\n')   // Escape newlines
                                .replace(/\r/g, '\\r')   // Escape carriage returns
                                .replace(/\t/g, '\\t');   // Escape tabs
                            return `"content": "${fixed}"`;
                        }
                        return match;
                    }
                );
                
                // Apply state machine fix again
                jsonContent = fixJsonStrings(jsonContent);
                
                // Try parsing again
                try {
                    result = JSON.parse(jsonContent) as IntegrationCode;
                } catch (secondErr: any) {
                    loggingService.error('JSON parsing failed after all fix attempts', {
                        userId,
                        error: secondErr.message,
                        errorStack: secondErr.stack,
                        jsonPreview: jsonContent.substring(0, 1000),
                        originalError: parseErr.message,
                        originalStack: parseErr.stack,
                        responsePreview: response.substring(0, 500)
                    });
                    // Don't throw - fall back to template instead
                    loggingService.warn('Using template fallback due to JSON parsing failure', {
                        userId
                    });
                    return this.generateNPMTemplate(options, apiKey);
                }
            }
            
            // Validate result structure
            if (!result.files || !Array.isArray(result.files) || result.files.length === 0) {
                loggingService.warn('AI response missing files, using template fallback', {
                    userId,
                    hasFiles: !!result.files,
                    filesType: typeof result.files,
                    filesLength: result.files?.length ?? 0
                });
                return this.generateNPMTemplate(options, apiKey);
            }
            
            // Post-process files for TypeScript projects
            if (analysis.language === 'typescript') {
                // Filter out .js files in build directories and convert .js to .ts for source files
                result.files = result.files
                    .filter(file => {
                        const path = file.path.toLowerCase();
                        // Exclude files in build/output directories
                        if (path.includes('/dist/') || path.includes('/build/') || 
                            path.includes('/out/') || path.includes('/lib/') ||
                            path.includes('/.next/') || path.includes('/node_modules/')) {
                            loggingService.warn('Filtered out build output file', {
                                userId,
                                path: file.path
                            });
                            return false;
                        }
                        // Convert .js to .ts for source files in src/
                        if (path.endsWith('.js') && !path.includes('/dist/') && !path.includes('/build/')) {
                            const originalPath = file.path;
                            file.path = file.path.replace(/\.js$/, '.ts');
                            loggingService.info('Converted .js to .ts for TypeScript project', {
                                userId,
                                originalPath,
                                newPath: file.path
                            });
                        }
                        return true;
                    })
                    .map(file => {
                        // Ensure TypeScript files have .ts extension
                        if (!file.path.endsWith('.ts') && !file.path.endsWith('.tsx') && 
                            !file.path.endsWith('.json') && !file.path.endsWith('.md') &&
                            !file.path.endsWith('.example') && !file.path.endsWith('.env')) {
                            // Only change if it's a code file (not config/doc)
                            if (file.path.match(/\.(js|jsx)$/i)) {
                                file.path = file.path.replace(/\.(js|jsx)$/i, '.ts');
                            }
                        }
                        return file;
                    });
            }
            
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
                errorStack: error.stack,
                response: response.substring(0, 500),
                responseLength: response?.length ?? 0
            });
            
            // Fallback to template-based generation instead of failing
            loggingService.info('Falling back to template-based generation due to parse error', {
                userId
            });
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

        // Add timeout wrapper for CLI integration
        const CODE_GENERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        let response: string;
        try {
            response = await Promise.race([
                BedrockService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0', // Use Claude Opus 4.1 for CLI integration
                    { useSystemPrompt: false }
                ) as Promise<string>,
                new Promise<string>((_, reject) => 
                    setTimeout(() => reject(new Error('CLI integration code generation timeout')), CODE_GENERATION_TIMEOUT)
                )
            ]);
        } catch (error: any) {
            loggingService.warn('Claude Opus 4.1 failed for CLI, using template fallback', {
                userId,
                error: error.message
            });
            return this.generateCLITemplate(options, apiKey);
        }

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

        // Add timeout wrapper for Python integration
        const CODE_GENERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        let response: string;
        try {
            response = await Promise.race([
                BedrockService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0', // Use Claude Opus 4.1 for Python integration
                    { useSystemPrompt: false }
                ) as Promise<string>,
                new Promise<string>((_, reject) => 
                    setTimeout(() => reject(new Error('Python integration code generation timeout')), CODE_GENERATION_TIMEOUT)
                )
            ]);
        } catch (error: any) {
            loggingService.warn('Claude Opus 4.1 failed for Python, using template fallback', {
                userId,
                error: error.message
            });
            return this.generatePythonTemplate(options, apiKey);
        }

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
     * Generate HTTP Headers integration
     */
    private static async generateHTTPHeadersIntegration(
        userId: string,
        options: CodeGenerationOptions,
        context: string
    ): Promise<IntegrationCode> {
        const { analysis, features, repositoryName, apiKey } = options;

        const prompt = `You are an expert helping integrate CostKatana via HTTP headers into a ${analysis.language} project.

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
Generate code examples showing how to add CostKatana tracking headers to HTTP requests for making AI API calls. The integration should:
1. Add CostKatana-Auth header with Bearer token (API key)
2. Optionally include CostKatana-Project-Id, CostKatana-Request-Id, CostKatana-Session-Id headers
3. Proxy requests through CostKatana gateway: https://cost-katana-backend.store/api/gateway/v1/chat/completions
4. Support multiple HTTP client libraries (fetch, axios, requests, etc.) based on the project's detected language/framework
5. Include error handling and logging
6. Create a reusable helper/utility module

Requirements:
- Use modern syntax for the detected language/framework
- Follow the project's existing patterns (detected: ${(analysis.detectedPatterns && analysis.detectedPatterns.length > 0) ? analysis.detectedPatterns.join(', ') : 'standard patterns'})
- Include comprehensive examples for different HTTP clients (fetch, axios, requests, http.client, curl, etc.)
- Add TypeScript types if project uses TypeScript
- Generate production-ready, well-documented code
- Include example usage for each selected feature
- CRITICAL: For TypeScript projects (language is 'typescript'), ONLY generate .ts files. Do NOT generate .js files.
- CRITICAL: Only generate source files, never generate files in dist/, build/, or other output directories

Return a JSON object with this exact structure:
{
  "files": [
    {
      "path": "src/utils/costkatana-client.${analysis.language === 'typescript' ? 'ts' : 'js'}",
      "content": "// CostKatana HTTP client helper with headers",
      "description": "CostKatana HTTP headers integration utility"
    },
    {
      "path": "COSTKATANA_HTTP_SETUP.md",
      "content": "# CostKatana HTTP Headers Integration Setup\\n\\n...",
      "description": "Comprehensive setup guide with examples for multiple languages"
    }
  ],
  "envVars": {
    "COSTKATANA_API_KEY": "Your CostKatana API key",
    "COSTKATANA_GATEWAY_URL": "https://cost-katana-backend.store/api/gateway/v1/chat/completions"
  },
  "installCommands": [],
  "setupInstructions": "Detailed markdown instructions",
  "testingSteps": ["Step 1: Configure API key", "Step 2: Test HTTP request with headers"]
}`;

        // Add timeout wrapper for HTTP headers integration
        const CODE_GENERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        loggingService.info('Calling Claude Opus 4.1 for HTTP headers integration generation', {
            userId,
            integrationType: 'http-headers',
            promptLength: prompt.length,
            timestamp: new Date().toISOString()
        });
        
        let response: string;
        const startTime = Date.now();
        try {
            response = await Promise.race([
                BedrockService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0', // Use Claude Opus 4.1 for HTTP headers integration
                    { useSystemPrompt: false }
                ) as Promise<string>,
                new Promise<string>((_, reject) => 
                    setTimeout(() => reject(new Error('HTTP headers integration code generation timeout')), CODE_GENERATION_TIMEOUT)
                )
            ]);
            
            const elapsed = Date.now() - startTime;
            loggingService.info('Claude Opus 4.1 HTTP headers integration response received', {
                userId,
                elapsedMs: elapsed,
                responseLength: response.length
            });
        } catch (error: any) {
            const elapsed = Date.now() - startTime;
            loggingService.warn('Claude Opus 4.1 failed for HTTP headers integration, using template fallback', {
                userId,
                error: error.message,
                elapsedMs: elapsed
            });
            return this.generateHTTPHeadersTemplate(options, apiKey);
        }

        try {
            // Remove markdown code blocks if present
            let cleanedResponse = response.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
            
            // Fix unescaped newlines and special characters in JSON strings
            cleanedResponse = this.fixJsonStringEscaping(cleanedResponse);
            
            const jsonMatch = cleanedResponse.match(/\{[\s\S]*\}/);
            if (!jsonMatch) {
                throw new Error('Invalid AI response format - no JSON found');
            }
            
            const parsed = JSON.parse(jsonMatch[0]) as IntegrationCode;
            
            // Post-process: Filter out build directories and fix file extensions for TypeScript
            if (analysis.language === 'typescript') {
                parsed.files = parsed.files
                    .filter((file: any) => {
                        // Filter out files in build/output directories
                        const excludedPatterns = ['/dist/', '/build/', '/out/', '/lib/', '/.next/', '/node_modules/'];
                        return !excludedPatterns.some(pattern => file.path.includes(pattern));
                    })
                    .map((file: any) => {
                        // Convert .js to .ts for source files (but keep .js in paths like node_modules)
                        if (file.path.endsWith('.js') && !file.path.includes('node_modules') && !file.path.includes('dist/')) {
                            file.path = file.path.replace(/\.js$/, '.ts');
                        }
                        return file;
                    });
            }
            
            // Validate that we have files
            if (!parsed.files || parsed.files.length === 0) {
                throw new Error('No files generated');
            }
            
            loggingService.info('HTTP headers integration code parsed successfully', {
                userId,
                filesGenerated: parsed.files.length
            });
            
            return parsed;
        } catch (parseError: any) {
            loggingService.error('Failed to parse HTTP headers integration JSON response', {
                userId,
                error: parseError.message,
                stack: parseError.stack,
                responseSnippet: response.substring(0, 500)
            });
            return this.generateHTTPHeadersTemplate(options, apiKey);
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

    /**
     * Fallback HTTP Headers template
     */
    private static generateHTTPHeadersTemplate(
        options: CodeGenerationOptions,
        apiKey: string
    ): IntegrationCode {
        const { analysis } = options;
        const isTypeScript = analysis.language === 'typescript';
        const ext = isTypeScript ? 'ts' : 'js';
        const gatewayUrl = process.env.COSTKATANA_GATEWAY_URL ?? 'https://cost-katana-backend.store/api/gateway/v1/chat/completions';

        // Generate client utility based on language
        let clientFile = '';
        let setupGuide = '';

        if (analysis.language === 'python') {
            clientFile = `"""CostKatana HTTP Headers Integration Client."""
import os
import requests
from typing import Optional, Dict, Any
import uuid

class CostKatanaClient:
    """Client for making AI requests through CostKatana gateway with headers."""
    
    def __init__(
        self,
        api_key: Optional[str] = None,
        gateway_url: Optional[str] = None,
        project_id: Optional[str] = None
    ):
        self.api_key = api_key or os.getenv('COSTKATANA_API_KEY', '${apiKey}')
        self.gateway_url = gateway_url or os.getenv('COSTKATANA_GATEWAY_URL', '${gatewayUrl}')
        self.project_id = project_id or os.getenv('COSTKATANA_PROJECT_ID')
        self.session_id = str(uuid.uuid4())
    
    def _get_headers(self, request_id: Optional[str] = None) -> Dict[str, str]:
        """Generate CostKatana tracking headers."""
        headers = {
            'Content-Type': 'application/json',
            'CostKatana-Auth': f'Bearer {self.api_key}',
            'CostKatana-Request-Id': request_id or str(uuid.uuid4())
        }
        
        if self.project_id:
            headers['CostKatana-Project-Id'] = self.project_id
        
        headers['CostKatana-Session-Id'] = self.session_id
        
        return headers
    
    def chat_completion(
        self,
        model: str,
        messages: list,
        **kwargs
    ) -> Dict[str, Any]:
        """Make a chat completion request through CostKatana gateway."""
        url = f'{self.gateway_url}/v1/chat/completions'
        
        payload = {
            'model': model,
            'messages': messages,
            **kwargs
        }
        
        response = requests.post(
            url,
            json=payload,
            headers=self._get_headers()
        )
        response.raise_for_status()
        return response.json()

# Example usage
if __name__ == '__main__':
    client = CostKatanaClient()
    response = client.chat_completion(
        model='gpt-4',
        messages=[{'role': 'user', 'content': 'Hello, world!'}]
    )
    print(response)
`;

            setupGuide = `# CostKatana HTTP Headers Integration

## Setup

1. **Set environment variables:**
\`\`\`bash
export COSTKATANA_API_KEY='${apiKey}'
export COSTKATANA_GATEWAY_URL='${gatewayUrl}'
export COSTKATANA_PROJECT_ID='your-project-id'  # Optional
\`\`\`

2. **Use the client in your code:**
\`\`\`python
from costkatana_client import CostKatanaClient

client = CostKatanaClient()
response = client.chat_completion(
    model='gpt-4',
    messages=[{'role': 'user', 'content': 'Hello!'}]
)
\`\`\`

## Examples

### Using requests directly:
\`\`\`python
import requests

headers = {
    'Content-Type': 'application/json',
    'CostKatana-Auth': f'Bearer {os.getenv("COSTKATANA_API_KEY")}',
    'CostKatana-Request-Id': str(uuid.uuid4())
}

response = requests.post(
    '${gatewayUrl}/v1/chat/completions',
    json={'model': 'gpt-4', 'messages': [...]},
    headers=headers
)
\`\`\`

### Using curl:
\`\`\`bash
curl -X POST '${gatewayUrl}/v1/chat/completions' \\
  -H 'Content-Type: application/json' \\
  -H 'CostKatana-Auth: Bearer ${apiKey}' \\
  -H 'CostKatana-Request-Id: $(uuidgen)' \\
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Hello!"}]
  }'
\`\`\`
`;
        } else {
            // JavaScript/TypeScript
            const typeAnnotation = isTypeScript ? ': string' : '';
            
            clientFile = `${isTypeScript ? "interface ChatMessage {\n    role: 'user' | 'assistant' | 'system';\n    content: string;\n}\n\n" : ""}
/** CostKatana HTTP Headers Integration Client */
class CostKatanaClient {
    private apiKey${typeAnnotation};
    private gatewayUrl${typeAnnotation};
    private projectId${typeAnnotation} | null;
    private sessionId${typeAnnotation};
    
    constructor(
        apiKey${typeAnnotation} = process.env.COSTKATANA_API_KEY || '${apiKey}',
        gatewayUrl${typeAnnotation} = process.env.COSTKATANA_GATEWAY_URL || '${gatewayUrl}',
        projectId${typeAnnotation} | null = process.env.COSTKATANA_PROJECT_ID || null
    ) {
        this.apiKey = apiKey;
        this.gatewayUrl = gatewayUrl;
        this.projectId = projectId;
        this.sessionId = this.generateRequestId();
    }
    
    private generateRequestId(): string {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
            const r = Math.random() * 16 | 0;
            const v = c === 'x' ? r : (r & 0x3 | 0x8);
            return v.toString(16);
        });
    }
    
    private getHeaders(requestId${typeAnnotation} = this.generateRequestId()) {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'CostKatana-Auth': \`Bearer \${this.apiKey}\`,
            'CostKatana-Request-Id': requestId
        };
        
        if (this.projectId) {
            headers['CostKatana-Project-Id'] = this.projectId;
        }
        
        headers['CostKatana-Session-Id'] = this.sessionId;
        
        return headers;
    }
    
    async chatCompletion(
        model: string,
        messages: Array<{ role: string; content: string }>,
        options: Record<string, any> = {}
    ): Promise<any> {
        const url = \`\${this.gatewayUrl}/v1/chat/completions\`;
        
        const response = await fetch(url, {
            method: 'POST',
            headers: this.getHeaders(),
            body: JSON.stringify({
                model,
                messages,
                ...options
            })
        });
        
        if (!response.ok) {
            throw new Error(\`HTTP error! status: \${response.status}\`);
        }
        
        return await response.json();
    }
}

${isTypeScript ? 'export default CostKatanaClient;' : 'module.exports = CostKatanaClient;'}
`;

            setupGuide = `# CostKatana HTTP Headers Integration

## Setup

1. **Set environment variables:**
\`\`\`bash
export COSTKATANA_API_KEY='${apiKey}'
export COSTKATANA_GATEWAY_URL='${gatewayUrl}'
export COSTKATANA_PROJECT_ID='your-project-id'  # Optional
\`\`\`

2. **Use the client in your code:**
\`\`\`${isTypeScript ? 'typescript' : 'javascript'}
import CostKatanaClient from './utils/costkatana-client';

const client = new CostKatanaClient();
const response = await client.chatCompletion(
    'gpt-4',
    [{ role: 'user', content: 'Hello!' }]
);
\`\`\`

## Examples

### Using fetch directly:
\`\`\`javascript
const headers = {
    'Content-Type': 'application/json',
    'CostKatana-Auth': \`Bearer \${process.env.COSTKATANA_API_KEY}\`,
    'CostKatana-Request-Id': crypto.randomUUID()
};

const response = await fetch('${gatewayUrl}/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify({
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello!' }]
    })
});
\`\`\`

### Using axios:
\`\`\`javascript
import axios from 'axios';

const response = await axios.post(
    '${gatewayUrl}/v1/chat/completions',
    {
        model: 'gpt-4',
        messages: [{ role: 'user', content: 'Hello!' }]
    },
    {
        headers: {
            'CostKatana-Auth': \`Bearer \${process.env.COSTKATANA_API_KEY}\`,
            'CostKatana-Request-Id': crypto.randomUUID()
        }
    }
);
\`\`\`
`;
        }

        return {
            files: [
                {
                    path: `src/utils/costkatana-client.${ext}`,
                    content: clientFile,
                    description: 'CostKatana HTTP headers integration client utility'
                },
                {
                    path: 'COSTKATANA_HTTP_SETUP.md',
                    content: setupGuide,
                    description: 'Comprehensive HTTP headers integration setup guide'
                },
                {
                    path: '.env.example',
                    content: `COSTKATANA_API_KEY=${apiKey}
COSTKATANA_GATEWAY_URL=${gatewayUrl}
COSTKATANA_PROJECT_ID=your-project-id  # Optional
`,
                    description: 'Environment variables template'
                }
            ],
            envVars: {
                'COSTKATANA_API_KEY': apiKey,
                'COSTKATANA_GATEWAY_URL': gatewayUrl
            },
            installCommands: [],
            setupInstructions: '# CostKatana HTTP Headers Setup\n\n1. Configure environment variables\n2. Import the client utility\n3. Make requests through CostKatana gateway',
            testingSteps: [
                'Set COSTKATANA_API_KEY environment variable',
                'Import and initialize the client',
                'Make a test AI request through the gateway'
            ]
        };
    }
}

export default GitHubCodeGeneratorService;



