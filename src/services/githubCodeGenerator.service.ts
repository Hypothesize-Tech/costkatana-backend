import { AIRouterService } from './aiRouter.service';
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
    existingFileContents?: Record<string, string>; // Existing file contents for code preservation
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

            // Validate and fix generated code
            integrationCode = await this.validateAndFixGeneratedCode(
                userId,
                integrationCode,
                options.analysis
            );

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
     * Validate and fix generated code for common issues
     */
    private static async validateAndFixGeneratedCode(
        userId: string,
        integrationCode: IntegrationCode,
        analysis: AnalysisResult
    ): Promise<IntegrationCode> {
        loggingService.info('Starting code validation', {
            userId,
            filesCount: integrationCode.files.length,
            language: analysis.language
        });

        const expectedExtension = analysis.language === 'typescript' ? 'ts' : 
                                  analysis.language === 'javascript' ? 'js' :
                                  analysis.language === 'python' ? 'py' :
                                  analysis.language === 'java' ? 'java' :
                                  analysis.language === 'go' ? 'go' : 'js';

        const wrongExtension = analysis.language === 'typescript' ? 'js' : 
                              analysis.language === 'javascript' ? 'ts' : null;

        const forbiddenDirs = ['dist', 'build', 'out', 'lib', '.next', '.nuxt', 'node_modules', '.cache'];

        let validationErrors: string[] = [];
        let autoFixCount = 0;

        // Validate and fix each file
        integrationCode.files = integrationCode.files.map((file) => {
            const originalPath = file.path;
            let modified = false;

            // Check 1: Validate file extension
            if (wrongExtension && file.path.endsWith(`.${wrongExtension}`)) {
                file.path = file.path.replace(new RegExp(`\\.${wrongExtension}$`), `.${expectedExtension}`);
                validationErrors.push(`❌ CRITICAL: File had wrong extension: ${originalPath} → Fixed to: ${file.path}`);
                autoFixCount++;
                modified = true;

                loggingService.warn('Auto-fixed file extension', {
                    userId,
                    originalPath,
                    newPath: file.path,
                    expectedExtension,
                    wrongExtension
                });
            }

            // Check 2: Validate not in build output directories
            const pathLower = file.path.toLowerCase();
            const inForbiddenDir = forbiddenDirs.some(dir => 
                pathLower.startsWith(`${dir}/`) || 
                pathLower.includes(`/${dir}/`)
            );

            if (inForbiddenDir) {
                // Try to fix by moving to src/
                const fileName = file.path.split('/').pop() || file.path;
                file.path = `src/${fileName}`;
                validationErrors.push(`⚠️ WARNING: File was in build directory: ${originalPath} → Moved to: ${file.path}`);
                autoFixCount++;
                modified = true;

                loggingService.warn('Auto-fixed forbidden directory', {
                    userId,
                    originalPath,
                    newPath: file.path
                });
            }

            // Check 3: Validate TypeScript code quality for .ts files
            if (analysis.language === 'typescript' && file.path.endsWith('.ts')) {
                const issues = this.validateTypeScriptCode(file.content);
                if (issues.length > 0) {
                    validationErrors.push(...issues.map(issue => `⚠️ TypeScript Issue in ${file.path}: ${issue}`));
                }
            }

            // Check 4: Validate code doesn't delete existing functionality
            if (file.content.length < 100 && !file.path.endsWith('.md') && !file.path.endsWith('.example')) {
                validationErrors.push(`⚠️ WARNING: File ${file.path} has suspiciously short content (${file.content.length} chars) - may have deleted existing code`);
            }

            return file;
        });

        // Check 5: Ensure main integration file exists with correct extension
        const mainIntegrationFile = `src/costkatana.${expectedExtension}`;
        const hasMainFile = integrationCode.files.some(f => 
            f.path === mainIntegrationFile ||
            f.path.endsWith(`/costkatana.${expectedExtension}`)
        );

        if (!hasMainFile) {
            validationErrors.push(`❌ CRITICAL: Main integration file missing: ${mainIntegrationFile}`);
        }

        // Log validation results
        if (validationErrors.length > 0) {
            loggingService.warn('Code validation found issues', {
                userId,
                errorsCount: validationErrors.length,
                autoFixCount,
                errors: validationErrors
            });
        } else {
            loggingService.info('Code validation passed', {
                userId,
                filesValidated: integrationCode.files.length
            });
        }

        // If critical errors remain after auto-fix, throw error
        const criticalErrors = validationErrors.filter(e => e.includes('❌ CRITICAL'));
        if (criticalErrors.length > 0 && autoFixCount === 0) {
            throw new Error(`Code generation validation failed:\n${criticalErrors.join('\n')}`);
        }

        return integrationCode;
    }

    /**
     * Validate TypeScript code quality
     */
    private static validateTypeScriptCode(content: string): string[] {
        const issues: string[] = [];

        // Check for TypeScript types
        if (!content.includes('interface') && !content.includes('type ') && !content.includes(': ')) {
            issues.push('Missing TypeScript type annotations');
        }

        // Check for async/await (not .then)
        if (content.includes('.then(') && !content.includes('// legacy')) {
            issues.push('Uses .then() instead of async/await');
        }

        // Check for proper exports
        if (!content.includes('export ') && !content.includes('export default')) {
            issues.push('No exports found - file may not be importable');
        }

        // Check for error handling
        if (content.includes('async ') && !content.includes('try') && !content.includes('catch')) {
            issues.push('Async functions missing try/catch error handling');
        }

        return issues;
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

        const fileExtension = analysis.language === 'typescript' ? 'ts' : 'js';
        const mainEntryPoint = analysis.entryPoints[0]?.replace(/\.js$/, `.${fileExtension}`) || `src/index.${fileExtension}`;
        const serverEntryPoint = analysis.framework === 'express' || analysis.projectType === 'api' 
            ? `src/server.${fileExtension}` 
            : null;

        const prompt = `🚨🚨🚨 CRITICAL FILE EXTENSION REQUIREMENT - READ FIRST 🚨🚨🚨

PROJECT LANGUAGE: ${analysis.language.toUpperCase()}
REQUIRED FILE EXTENSION: .${fileExtension}
${analysis.language === 'typescript' ? '❌ FORBIDDEN: .js files | ✅ REQUIRED: .ts files' : '❌ FORBIDDEN: .ts files | ✅ REQUIRED: .js files'}

YOU ARE INTEGRATING INTO A ${analysis.language.toUpperCase()} PROJECT. THIS MEANS:
${analysis.language === 'typescript' ? `
✅ CORRECT EXAMPLES:
   - src/costkatana.ts
   - src/index.ts
   - src/server.ts
   
❌ WRONG EXAMPLES (DO NOT USE):
   - src/costkatana.js  ← WRONG!
   - src/index.js       ← WRONG!
   - src/server.js      ← WRONG!
` : `
✅ CORRECT EXAMPLES:
   - src/costkatana.js
   - src/index.js
   - src/server.js
   
❌ WRONG EXAMPLES (DO NOT USE):
   - src/costkatana.ts  ← WRONG!
   - src/index.ts       ← WRONG!
   - src/server.ts      ← WRONG!
`}

Repository: ${repositoryName}

Repository Analysis:
- Language: ${analysis.language} (Confidence: ${analysis.languageConfidence || 100}%)${analysis.isTypeScriptPrimary ? ' [TypeScript-Primary]' : ''}
- Framework: ${analysis.framework ?? 'None detected'}
- Project Type: ${analysis.projectType}
- Entry Points: ${analysis.entryPoints.join(', ')}
- Existing AI Integrations: ${analysis.existingAIIntegrations.join(', ') ?? 'None'}
- Package Manager: ${analysis.packageManager ?? 'npm'}

${Object.keys(options.existingFileContents || {}).length > 0 ? `
EXISTING FILE CONTENTS TO PRESERVE:
The following files already exist in the repository. You MUST preserve their existing code and ONLY ADD CostKatana integration:

${Object.entries(options.existingFileContents || {}).map(([path, content]) => `
--- File: ${path} (${content.length} characters) ---
${content.substring(0, 3000)}${content.length > 3000 ? '\n... (truncated for brevity, but you MUST preserve ALL content)' : ''}
--- End of ${path} ---
`).join('\n')}

⚠️ CRITICAL: When updating these files, you MUST:
1. Keep ALL existing code exactly as is - NO EXCEPTIONS
2. Only ADD new CostKatana-related imports at the top (after existing imports)
3. Only ADD initialization calls where appropriate (after existing initialization)
4. Do NOT remove, modify, or replace ANY existing functionality
5. Do NOT change existing imports, middleware, routes, or handlers
6. Do NOT comment out ANY existing code - ALL existing code must remain active
7. Do NOT add "PRESERVE" or "EXISTING CODE" comments - just keep the code as-is
8. The updated file should contain: [ALL ORIGINAL CODE] + [NEW CostKatana imports] + [NEW CostKatana initialization]
` : ''}

Selected Features:
${features.map(f => `- ${f.name}${f.config ? ': ' + JSON.stringify(f.config) : ''}`).join('\n')}

Integration Context:
${context}

Your task:
1. Generate a NEW integration file: src/costkatana.${fileExtension} (EXTENSION MUST BE .${fileExtension})
2. UPDATE the main entry point (${mainEntryPoint}) to ADD CostKatana import and initialization
3. Create a comprehensive .env.example with all required CostKatana variables
4. Generate a detailed setup guide (COSTKATANA_SETUP.md)

🚨🚨🚨 CRITICAL RULES - FAILURE TO FOLLOW THESE WILL BREAK THE PROJECT 🚨🚨🚨

FILE NAMING RULES (MANDATORY - ZERO TOLERANCE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT: This is a ${analysis.language.toUpperCase()} project
✅ CORRECT: ALL source files MUST use .${fileExtension} extension
✅ CORRECT: Main integration file MUST be: src/costkatana.${fileExtension}
✅ CORRECT: Entry point file: ${mainEntryPoint}
${serverEntryPoint ? `✅ CORRECT: Server file: ${serverEntryPoint}` : ''}

❌ FORBIDDEN: .${analysis.language === 'typescript' ? 'js' : 'ts'} files for ${analysis.language.toUpperCase()} projects
❌ FORBIDDEN: src/costkatana.${analysis.language === 'typescript' ? 'js' : 'ts'} ← THIS WILL CAUSE BUILD FAILURE
❌ FORBIDDEN: ${mainEntryPoint.replace(new RegExp(`\\.${fileExtension}$`), `.${analysis.language === 'typescript' ? 'js' : 'ts'}`)} ← WRONG EXTENSION
❌ FORBIDDEN: Files in dist/, build/, out/, lib/, .next/, or node_modules/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

VALIDATION CHECKPOINT:
Before generating any file path, ask yourself:
1. Is this a ${analysis.language.toUpperCase()} project? YES
2. Does the file extension match .${fileExtension}? (Must be YES)
3. Is the file in a source directory (src/, not dist/)? (Must be YES)

CODE PRESERVATION (MANDATORY - ZERO TOLERANCE):
- DO NOT DELETE any existing code, routes, or functionality
- DO NOT REMOVE any imports, middleware, or configurations
- DO NOT MODIFY existing function implementations
- DO NOT COMMENT OUT any existing code - keep everything active
- DO NOT add "// EXISTING CODE PRESERVED" or similar comments
- ONLY ADD CostKatana-related code (append, don't replace):
  * Add import statement AFTER existing imports: import costKatanaService from './costkatana${analysis.language === 'typescript' ? '' : '.js'}';
  * Add initialization call AFTER existing initialization: await costKatanaService.initialize();
  * Optional: Add middleware AFTER existing middleware if auto-tracking is enabled
- PRESERVE ALL existing code EXACTLY as-is:
  * All routes and route handlers (keep 100% of them)
  * All middleware configurations (keep 100% of them)
  * All database connections (keep 100% of them)
  * All error handlers (keep 100% of them)
  * All event listeners (keep 100% of them)
  * All existing imports and exports (keep 100% of them)
  * All existing functions, classes, and logic (keep 100% of them)

EXAMPLE OF CORRECT UPDATE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// BEFORE (original file):
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// ... other existing imports ...

const app = express();
app.use(cors());
app.use(helmet());
// ... all existing middleware ...

app.get('/api/users', (req, res) => {
  // existing route handler
});

// AFTER (correct update - ONLY ADD, NEVER REMOVE):
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
// ... other existing imports ...
import costKatanaService from './costkatana'; // ← ONLY ADD THIS

const app = express();
app.use(cors());
app.use(helmet());
// ... all existing middleware ...

// Initialize CostKatana
await costKatanaService.initialize(); // ← ONLY ADD THIS

app.get('/api/users', (req, res) => {
  // existing route handler - UNCHANGED
});
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CODE QUALITY REQUIREMENTS:
${analysis.language === 'typescript' ? `
- Use TypeScript with proper type annotations
- Add interface/type definitions for all CostKatana configurations
- Use async/await (NOT .then().catch())
- Include JSDoc comments with @param and @returns tags
- Export types for external use
` : `
- Use modern ES6+ syntax
- Include JSDoc comments for all functions
- Use async/await (NOT .then().catch())
- Add proper error handling with try/catch
`}
- Follow the project's existing patterns: ${(analysis.detectedPatterns && analysis.detectedPatterns.length > 0) ? analysis.detectedPatterns.join(', ') : 'standard patterns'}
- Include comprehensive error handling
- Add detailed logging for debugging
- Generate production-ready, well-tested code
- Include example usage for each selected feature

FINAL VERIFICATION BEFORE RETURNING:
□ All file paths end with .${fileExtension} (NOT .${analysis.language === 'typescript' ? 'js' : 'ts'})
□ No files are in dist/, build/, or output directories
□ TypeScript types are included if language is TypeScript
□ Existing code is preserved in updated files
□ Imports use correct file extensions

Return a JSON object with this exact structure:
{
  "files": [
    {
      "path": "src/costkatana.${fileExtension}",
      "content": "// file content here with ${analysis.language === 'typescript' ? 'TypeScript types' : 'modern ES6'}",
      "description": "CostKatana configuration and initialization"
    },
    {
      "path": "${mainEntryPoint}",
      "content": "// updated entry point with CostKatana import - MUST preserve all existing code",
      "description": "Main entry point updated with CostKatana integration"
    }
  ],
  "envVars": {
    "COSTKATANA_API_KEY": "Your CostKatana API key",
    "COSTKATANA_DEFAULT_MODEL": "amazon.nova-lite-v1:0"
  },
  "installCommands": ["${analysis.packageManager ?? 'npm'} install cost-katana${analysis.language === 'typescript' ? ' && npm install --save-dev @types/node' : ''}"],
  "setupInstructions": "Detailed markdown instructions",
  "testingSteps": ["Step 1", "Step 2"]
}

🚨 REMINDER: Before you return, verify EVERY file path ends with .${fileExtension} 🚨`;

        // Add timeout wrapper for code generation (8 minutes max - increased for complex projects)
        const CODE_GENERATION_TIMEOUT = 8 * 60 * 1000; // 8 minutes
        const PROGRESS_INTERVALS = [20, 40, 60, 80]; // Log progress at 20%, 40%, 60%, 80%
        
        loggingService.info('[0%] Starting code generation with Claude Opus 4.1', {
            userId,
            integrationType: 'npm',
            promptLength: prompt.length,
            language: analysis.language,
            features: features.map(f => f.name),
            timestamp: new Date().toISOString()
        });
        
        let response: string;
        const startTime = Date.now();
        
        // Set up progress tracking
        const progressIntervalId = setInterval(() => {
            const elapsed = Date.now() - startTime;
            const percentComplete = Math.min(Math.floor((elapsed / CODE_GENERATION_TIMEOUT) * 100), 95);
            
            if (PROGRESS_INTERVALS.includes(percentComplete)) {
                loggingService.info(`[${percentComplete}%] Code generation in progress`, {
                    userId,
                    elapsedMs: elapsed,
                    percentComplete,
                    integrationType: 'npm'
                });
            }
        }, 30000); // Check every 30 seconds
        
        try {
            response = await Promise.race([
                AIRouterService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0' // Use Claude Opus 4.1 for complex code generation
                ) as Promise<string>,
                new Promise<string>((_, reject) => 
                    setTimeout(() => {
                        const elapsed = Date.now() - startTime;
                        loggingService.error('[TIMEOUT] Code generation timeout reached', {
                            userId,
                            elapsedMs: elapsed,
                            timeout: CODE_GENERATION_TIMEOUT,
                            integrationType: 'npm',
                            suggestion: 'This may be due to AWS Bedrock throttling or model unavailability. Consider retrying or using a simpler model.'
                        });
                        reject(new Error('Code generation timed out after 8 minutes. This may be due to AWS Bedrock throttling, model unavailability, or high complexity. Please try again in a few moments.'));
                    }, CODE_GENERATION_TIMEOUT)
                )
            ]);
            
            clearInterval(progressIntervalId);
            
            const elapsed = Date.now() - startTime;
            loggingService.info('[100%] Claude Opus 4.1 response received successfully', {
                userId,
                elapsedMs: elapsed,
                responseLength: response?.length ?? 0,
                integrationType: 'npm'
            });
        } catch (error: any) {
            clearInterval(progressIntervalId); // Clean up progress tracking
            
            const elapsed = Date.now() - startTime;
            // Fallback to Claude 3.5 Sonnet if Opus 4.1 fails or times out
            loggingService.warn('[FALLBACK] Claude Opus 4.1 failed, attempting Claude 3.5 Sonnet', {
                userId,
                error: error.message,
                errorStack: error.stack,
                elapsedMs: elapsed,
                willRetry: true,
                integrationType: 'npm'
            });
            
            const fallbackStartTime = Date.now();
            try {
                response = await Promise.race([
                    AIRouterService.invokeModel(
                        prompt,
                        'anthropic.claude-3-5-sonnet-20240620-v1:0' // Fallback to Claude 3.5 Sonnet
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
            
            // Post-process files for TypeScript projects - ensure correct extensions
            if (analysis.language === 'typescript') {
                loggingService.info('Post-processing files for TypeScript project', {
                    userId,
                    originalFileCount: result.files.length,
                    files: result.files.map(f => f.path)
                });

                // Filter out .js files in build directories and convert .js to .ts for source files
                result.files = result.files
                    .filter(file => {
                        const path = file.path.toLowerCase();
                        
                        // Exclude files in build/output directories
                        const buildDirs = ['/dist/', '/build/', '/out/', '/lib/', '/.next/', '/node_modules/', '/coverage/', '/__tests__/'];
                        if (buildDirs.some(dir => path.includes(dir))) {
                            loggingService.warn('Filtered out build output file', {
                                userId,
                                path: file.path,
                                reason: 'build directory'
                            });
                            return false;
                        }
                        
                        return true;
                    })
                    .map(file => {
                        const originalPath = file.path;
                        const lowerPath = file.path.toLowerCase();
                        
                        // CRITICAL: Convert costkatana.js to costkatana.ts (check both includes and endsWith)
                        if (lowerPath.includes('costkatana') && (lowerPath.endsWith('.js') || lowerPath.includes('costkatana.js'))) {
                            file.path = file.path.replace(/costkatana\.js$/i, 'costkatana.ts');
                            if (file.path === originalPath) {
                                // Try alternative patterns
                                file.path = file.path.replace(/\/costkatana\.js$/i, '/costkatana.ts');
                                file.path = file.path.replace(/costkatana\.js$/i, 'costkatana.ts');
                            }
                            loggingService.warn('CRITICAL FIX: Converted costkatana.js to costkatana.ts', {
                                userId,
                                originalPath,
                                newPath: file.path,
                                wasFixed: file.path !== originalPath
                            });
                        }
                        
                        // Convert server.js to server.ts
                        if (lowerPath.includes('server') && (lowerPath.endsWith('.js') || lowerPath.includes('server.js'))) {
                            file.path = file.path.replace(/server\.js$/i, 'server.ts');
                            if (file.path !== originalPath) {
                                loggingService.info('Converted server.js to server.ts', {
                                    userId,
                                    originalPath,
                                    newPath: file.path
                                });
                            }
                        }
                        
                        // Convert index.js to index.ts (main entry points)
                        if (lowerPath.includes('index') && lowerPath.endsWith('.js') && !lowerPath.includes('node_modules')) {
                            file.path = file.path.replace(/index\.js$/i, 'index.ts');
                            if (file.path !== originalPath) {
                                loggingService.info('Converted index.js to index.ts', {
                                    userId,
                                    originalPath,
                                    newPath: file.path
                                });
                            }
                        }
                        
                        // Handle any remaining .js/.jsx files in src/ directories
                        if ((lowerPath.endsWith('.js') || lowerPath.endsWith('.jsx')) && lowerPath.includes('/src/')) {
                            const newPath = file.path.replace(/\.(js|jsx)$/i, '.ts');
                            if (newPath !== file.path) {
                                file.path = newPath;
                                loggingService.warn('Converted source file .js/.jsx to .ts', {
                                    userId,
                                    originalPath,
                                    newPath: file.path
                                });
                            }
                        }
                        
                        // FINAL PASS: Ensure ALL code files (except config) use .ts extension
                        const isConfigFile = lowerPath.endsWith('.json') || 
                                           lowerPath.endsWith('.md') || 
                                           lowerPath.endsWith('.example') || 
                                           lowerPath.endsWith('.env') ||
                                           lowerPath.endsWith('.gitignore') ||
                                           lowerPath.includes('.env.') ||
                                           lowerPath.includes('package.json') ||
                                           lowerPath.includes('tsconfig.json');
                        
                        if (!isConfigFile && 
                            !file.path.endsWith('.ts') && 
                            !file.path.endsWith('.tsx') && 
                            file.path.match(/\.(js|jsx)$/i)) {
                            const newPath = file.path.replace(/\.(js|jsx)$/i, '.ts');
                            loggingService.error('CRITICAL: Final pass converting .js file to .ts', {
                                userId,
                                originalPath: file.path,
                                newPath,
                                filePath: file.path,
                                warning: 'AI generated wrong extension - this should not happen!'
                            });
                            file.path = newPath;
                        }
                        
                        return file;
                    });
                
                loggingService.info('Post-processing complete', {
                    userId,
                    finalFileCount: result.files.length,
                    files: result.files.map(f => f.path)
                });
            }
            
            // Replace placeholder API key with actual key
            result.files.forEach(file => {
                file.content = file.content.replace(/your-costkatana-api-key/gi, apiKey);
                file.content = file.content.replace(/YOUR_API_KEY_HERE/gi, apiKey);
            });

            // CRITICAL VALIDATION: Check for code deletion or excessive commenting
            result.files.forEach(file => {
                const lowerPath = file.path.toLowerCase();
                const content = file.content;
                const lineCount = content.split('\n').length;
                
                // Check for excessive commented-out code (more than 20% of lines are preservation comments)
                const commentPatterns = [
                    /^\s*\/\/.*PRESERVE/i,
                    /^\s*\/\/.*EXISTING.*CODE/i,
                    /^\s*\/\/.*\[PRESERVE/i,
                    /^\s*\/\/.*\[EXISTING/i,
                    /^\s*#.*PRESERVE/i,
                    /^\s*#.*EXISTING.*CODE/i
                ];
                
                const commentedLines = content.split('\n').filter(line => {
                    const trimmed = line.trim();
                    return commentPatterns.some(pattern => pattern.test(trimmed));
                }).length;
                
                const commentPercentage = lineCount > 0 ? (commentedLines / lineCount) * 100 : 0;
                
                // Check for suspicious patterns indicating code deletion (only for server files)
                const missingPatterns: string[] = [];
                if (lowerPath.includes('server') && (lowerPath.endsWith('.ts') || lowerPath.endsWith('.js'))) {
                    const suspiciousPatterns = [
                        { pattern: /app\.use\(['"]\/api\//g, name: 'API routes', minOccurrences: 1 },
                        { pattern: /app\.listen\(/g, name: 'Server listen', minOccurrences: 1 },
                        { pattern: /mongoose\.connect\(/g, name: 'MongoDB connection', minOccurrences: 0 }, // Optional
                        { pattern: /express\(\)/g, name: 'Express app', minOccurrences: 1 },
                        { pattern: /import.*from/g, name: 'Import statements', minOccurrences: 3 }
                    ];
                    
                    suspiciousPatterns.forEach(({ pattern, name, minOccurrences }) => {
                        const matches = content.match(pattern);
                        const count = matches ? matches.length : 0;
                        if (count < minOccurrences) {
                            missingPatterns.push(`${name} (expected ${minOccurrences}, found ${count})`);
                        }
                    });
                }
                
                // If file is suspiciously short, missing patterns, or has excessive comments, try to fix
                if (lineCount < 50 || missingPatterns.length > 0 || commentPercentage > 20) {
                    loggingService.warn('⚠️ WARNING: Generated file may have excessive comments or missing code', {
                        userId,
                        filePath: file.path,
                        lineCount,
                        commentPercentage: commentPercentage.toFixed(1) + '%',
                        commentedLines,
                        missingPatterns,
                        contentLength: content.length,
                        recommendation: 'The generated file may have excessive preservation comments or missing code. Review carefully.'
                    });
                    
                    // Try to fix excessive commenting by removing preservation comments
                    if (commentPercentage > 20) {
                        let fixedContent = content;
                        
                        // Remove common preservation comment patterns
                        fixedContent = fixedContent.replace(/\/\/\s*\[PRESERVE[^\n]*\n/gi, '');
                        fixedContent = fixedContent.replace(/\/\/\s*\[EXISTING[^\n]*\n/gi, '');
                        fixedContent = fixedContent.replace(/\/\/\s*EXISTING CODE PRESERVED[^\n]*\n/gi, '');
                        fixedContent = fixedContent.replace(/\/\/\s*PRESERVE ALL EXISTING[^\n]*\n/gi, '');
                        fixedContent = fixedContent.replace(/#\s*\[PRESERVE[^\n]*\n/gi, '');
                        fixedContent = fixedContent.replace(/#\s*\[EXISTING[^\n]*\n/gi, '');
                        
                        // Remove multi-line preservation comment blocks
                        fixedContent = fixedContent.replace(/\/\/\s*\[PRESERVE ALL EXISTING[^\]]*\]/gis, '');
                        fixedContent = fixedContent.replace(/#\s*\[PRESERVE ALL EXISTING[^\]]*\]/gis, '');
                        
                        if (fixedContent !== content) {
                            file.content = fixedContent;
                            loggingService.info('Removed excessive preservation comments from generated file', {
                                userId,
                                filePath: file.path,
                                removedComments: content.length - fixedContent.length,
                                linesRemoved: commentedLines
                            });
                        }
                    }
                }
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
                AIRouterService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0' // Use Claude Opus 4.1 for CLI integration
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

        const mainEntryPoint = analysis.entryPoints[0] || 'main.py';

        const prompt = `You are an expert helping integrate CostKatana Python SDK (cost-katana) into a Python project.

Repository Analysis:
- Framework: ${analysis.framework ?? 'Python'}
- Entry Points: ${analysis.entryPoints.join(', ')}
- Existing AI Integrations: ${analysis.existingAIIntegrations.join(', ') ?? 'None'}
- Package Manager: ${analysis.packageManager ?? 'pip'}

${Object.keys(options.existingFileContents || {}).length > 0 ? `
EXISTING FILE CONTENTS TO PRESERVE:
The following files already exist in the repository. You MUST preserve their existing code and ONLY ADD CostKatana integration:

${Object.entries(options.existingFileContents || {}).map(([path, content]) => `
--- File: ${path} (${content.length} characters) ---
${content.substring(0, 3000)}${content.length > 3000 ? '\n... (truncated for brevity, but you MUST preserve ALL content)' : ''}
--- End of ${path} ---
`).join('\n')}

⚠️ CRITICAL: When updating these files, you MUST:
1. Keep ALL existing code exactly as is - NO EXCEPTIONS
2. Only ADD new CostKatana-related imports at the top (after existing imports)
3. Only ADD initialization calls where appropriate (after existing initialization)
4. Do NOT remove, modify, or replace ANY existing functionality
5. Do NOT change existing imports, routes, or handlers
6. Do NOT comment out ANY existing code - ALL existing code must remain active and uncommented
7. Do NOT add "PRESERVE" or "EXISTING CODE" comments - just keep the code as-is
8. The updated file should contain: [ALL ORIGINAL CODE] + [NEW CostKatana imports] + [NEW CostKatana initialization]
` : ''}

Selected Features:
${features.map(f => `- ${f.name}`).join('\n')}

Integration Context:
${context}

Your task:
1. Generate a NEW configuration module: costkatana_config.py
2. UPDATE the main entry point (${mainEntryPoint}) to ADD CostKatana import and initialization
3. Create/update requirements.txt with cost-katana dependency
4. Generate a detailed setup guide (COSTKATANA_SETUP.md)

🚨 CRITICAL RULES - READ CAREFULLY:

FILE NAMING (MANDATORY):
- This is a PYTHON project - ALL Python files MUST use .py extension
- Configuration module MUST be: costkatana_config.py (NOT .ts or .js)
- Entry point file: ${mainEntryPoint}
- NEVER generate wrong file extensions for Python projects

CODE PRESERVATION (MANDATORY - ZERO TOLERANCE):
- DO NOT DELETE any existing code, routes, or functionality
- DO NOT REMOVE any imports, middleware, or configurations
- DO NOT MODIFY existing function implementations
- DO NOT COMMENT OUT any existing code - keep everything active
- DO NOT add "# EXISTING CODE PRESERVED" or similar comments
- ONLY ADD CostKatana-related code (append, don't replace):
  * Add import statement AFTER existing imports: from costkatana_config import cost_katana
  * Add initialization call AFTER existing initialization: cost_katana.initialize()
  * Optional: Add middleware/decorator AFTER existing middleware if framework supports it
- PRESERVE ALL existing code EXACTLY as-is:
  * All routes and route handlers (keep 100% of them)
  * All Flask/Django/FastAPI configurations (keep 100% of them)
  * All database connections (keep 100% of them)
  * All error handlers (keep 100% of them)
  * All existing imports and exports (keep 100% of them)
  * All existing functions, classes, and logic (keep 100% of them)

Requirements:
- Follow PEP 8 style guidelines
- Include proper type hints
- Add comprehensive error handling
- Generate production-ready, well-documented code
- Include example usage for each selected feature

Return JSON with files, envVars, installCommands, setupInstructions, and testingSteps.`;

        // Add timeout wrapper for Python integration
        const CODE_GENERATION_TIMEOUT = 5 * 60 * 1000; // 5 minutes
        
        let response: string;
        try {
            response = await Promise.race([
                AIRouterService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0' // Use Claude Opus 4.1 for Python integration
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
            const result = JSON.parse(jsonMatch[0]) as IntegrationCode;
            
            // Validate and fix file extensions for Python
            if (result.files) {
                loggingService.info('Validating Python integration files', {
                    userId,
                    fileCount: result.files.length,
                    files: result.files.map(f => f.path)
                });
                
                result.files = result.files.map(file => {
                    const originalPath = file.path;
                    
                    // Ensure Python files have .py extension
                    if (!file.path.endsWith('.py') && 
                        !file.path.endsWith('.txt') && 
                        !file.path.endsWith('.md') && 
                        !file.path.endsWith('.example') &&
                        !file.path.endsWith('.json') &&
                        !file.path.endsWith('.yaml') &&
                        !file.path.endsWith('.yml')) {
                        
                        // Check if it's a Python config file
                        if (file.path.includes('costkatana')) {
                            file.path = file.path.replace(/\.(ts|js)$/i, '.py');
                            if (!file.path.endsWith('.py')) {
                                file.path = file.path + '.py';
                            }
                            loggingService.warn('Fixed Python file extension', {
                                userId,
                                originalPath,
                                newPath: file.path
                            });
                        }
                    }
                    
                    return file;
                });
                
                // Validate for code deletion
                result.files.forEach(file => {
                    const lowerPath = file.path.toLowerCase();
                    if (lowerPath.includes('app.py') || lowerPath.includes('main.py') || lowerPath.includes('server.py')) {
                        const content = file.content;
                        const lineCount = content.split('\n').length;
                        
                        const suspiciousPatterns = [
                            { pattern: /from\s+flask\s+import|from\s+fastapi\s+import|from\s+django/g, name: 'Framework imports', minOccurrences: 0 },
                            { pattern: /def\s+\w+\(/g, name: 'Function definitions', minOccurrences: 2 },
                            { pattern: /import\s+\w+|from\s+\w+\s+import/g, name: 'Import statements', minOccurrences: 3 },
                            { pattern: /@app\.route|@router\.get|@router\.post/g, name: 'Route decorators', minOccurrences: 0 }
                        ];
                        
                        const missingPatterns: string[] = [];
                        suspiciousPatterns.forEach(({ pattern, name, minOccurrences }) => {
                            const matches = content.match(pattern);
                            const count = matches ? matches.length : 0;
                            if (count < minOccurrences) {
                                missingPatterns.push(`${name} (expected ${minOccurrences}, found ${count})`);
                            }
                        });
                        
                        if (lineCount < 30 || missingPatterns.length > 1) {
                            loggingService.error('⚠️ CRITICAL: Generated Python file may have deleted existing code!', {
                                userId,
                                filePath: file.path,
                                lineCount,
                                missingPatterns,
                                warning: 'The generated Python file appears to be missing critical code!'
                            });
                        }
                    }
                });
            }
            
            return result;
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

        const fileExtension = analysis.language === 'typescript' ? 'ts' : 
                             analysis.language === 'javascript' ? 'js' :
                             analysis.language === 'python' ? 'py' :
                             analysis.language === 'java' ? 'java' :
                             analysis.language === 'go' ? 'go' : 'js';
        const configFileName = analysis.language === 'typescript' || analysis.language === 'javascript' 
            ? `costkatana-headers.${fileExtension}` 
            : analysis.language === 'python' ? 'costkatana_headers.py'
            : analysis.language === 'java' ? 'CostKatanaHeaders.java'
            : `costkatana-headers.${fileExtension}`;

        const prompt = `🚨🚨🚨 CRITICAL FILE EXTENSION REQUIREMENT - READ FIRST 🚨🚨🚨

PROJECT LANGUAGE: ${analysis.language.toUpperCase()}
REQUIRED FILE EXTENSION: .${fileExtension}
${analysis.language === 'typescript' ? '❌ FORBIDDEN: .js files | ✅ REQUIRED: .ts files' : analysis.language === 'javascript' ? '❌ FORBIDDEN: .ts files | ✅ REQUIRED: .js files' : ''}

Repository: ${repositoryName}

Repository Analysis:
- Language: ${analysis.language} (Confidence: ${analysis.languageConfidence || 100}%)${analysis.isTypeScriptPrimary ? ' [TypeScript-Primary]' : ''}
- Framework: ${analysis.framework ?? 'None detected'}
- Project Type: ${analysis.projectType}
- Entry Points: ${analysis.entryPoints.join(', ')}
- Existing AI Integrations: ${analysis.existingAIIntegrations.join(', ') ?? 'None'}
- Package Manager: ${analysis.packageManager ?? 'npm'}

Selected Features:
${features.map(f => `- ${f.name}${f.config ? ': ' + JSON.stringify(f.config) : ''}`).join('\n')}

Integration Context:
${context}

🚨🚨🚨 CRITICAL RULES - FAILURE TO FOLLOW WILL BREAK THE PROJECT 🚨🚨🚨

FILE NAMING (MANDATORY - ZERO TOLERANCE):
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ CORRECT: This is a ${analysis.language.toUpperCase()} project
✅ CORRECT: ALL source files MUST use .${fileExtension} extension
✅ CORRECT: Configuration helper file: ${configFileName}
${analysis.language === 'typescript' || analysis.language === 'javascript' ? `
✅ CORRECT: src/utils/costkatana-client.${fileExtension}
❌ FORBIDDEN: src/utils/costkatana-client.${analysis.language === 'typescript' ? 'js' : 'ts'} ← THIS WILL CAUSE BUILD FAILURE
` : ''}
❌ FORBIDDEN: Wrong file extensions (e.g., .${analysis.language === 'typescript' ? 'js' : analysis.language === 'javascript' ? 'ts' : 'ts'} for ${analysis.language.toUpperCase()} projects)
❌ FORBIDDEN: Files in dist/, build/, out/, lib/, .next/, or node_modules/
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

CODE PRESERVATION (MANDATORY):
- DO NOT DELETE any existing code
- DO NOT REMOVE any existing HTTP client code or API integrations
- ONLY ADD helper functions/classes for CostKatana headers
- PRESERVE ALL existing functionality

Your task:
Generate code examples showing how to add CostKatana tracking headers to HTTP requests for making AI API calls. The integration should:
1. Add CostKatana-Auth header with Bearer token (API key)
2. Optionally include CostKatana-Project-Id, CostKatana-Request-Id, CostKatana-Session-Id headers
3. Proxy requests through CostKatana gateway: https://api.costkatana.com/api/gateway/v1/chat/completions
4. Support multiple HTTP client libraries (fetch, axios, requests, etc.) based on the project's detected language/framework
5. Include error handling and logging
6. Create a reusable helper/utility module

CODE QUALITY REQUIREMENTS:
${analysis.language === 'typescript' ? `
- Use TypeScript with proper type annotations
- Add interface/type definitions for all configurations
- Use async/await (NOT .then().catch())
- Include JSDoc comments with @param and @returns tags
- Export types for external use
` : analysis.language === 'javascript' ? `
- Use modern ES6+ syntax
- Include JSDoc comments for all functions
- Use async/await (NOT .then().catch())
- Add proper error handling with try/catch
` : `
- Use modern ${analysis.language} syntax
- Include proper error handling
- Add comprehensive comments
`}
- Follow the project's existing patterns: ${(analysis.detectedPatterns && analysis.detectedPatterns.length > 0) ? analysis.detectedPatterns.join(', ') : 'standard patterns'}
- Include comprehensive examples for different HTTP clients
- Generate production-ready, well-documented code
- Include example usage for each selected feature

FINAL VERIFICATION BEFORE RETURNING:
□ All file paths end with .${fileExtension} (NOT .${analysis.language === 'typescript' ? 'js' : analysis.language === 'javascript' ? 'ts' : 'wrong-extension'})
□ No files are in dist/, build/, or output directories
□ TypeScript types are included if language is TypeScript
□ Code uses modern syntax for the detected language

Return a JSON object with this exact structure:
{
  "files": [
    {
      "path": "src/utils/costkatana-client.${fileExtension}",
      "content": "// CostKatana HTTP client helper with headers - ${analysis.language === 'typescript' ? 'TypeScript with types' : 'modern syntax'}",
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
    "COSTKATANA_GATEWAY_URL": "https://api.costkatana.com/api/gateway/v1/chat/completions"
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
                AIRouterService.invokeModel(
                    prompt,
                    'anthropic.claude-opus-4-1-20250805-v1:0' // Use Claude Opus 4.1 for HTTP headers integration
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
        const gatewayUrl = process.env.COSTKATANA_GATEWAY_URL ?? 'https://api.costkatana.com/api/gateway/v1/chat/completions';

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



