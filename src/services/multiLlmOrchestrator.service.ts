/**
 * Multi-LLM Orchestrator Service
 * Uses multiple LLMs for different stages of query processing:
 * 1. Query Analyzer (Fast LLM) - Understands user intent
 * 2. Tool Selector (Smart LLM) - Selects best tools
 * 3. Response Generator (Quality LLM) - Generates final response
 */

import { ChatBedrockConverse } from "@langchain/aws";
import { loggingService } from "./logging.service";

export interface QueryAnalysis {
    intent: string;
    category: 'vercel' | 'analytics' | 'knowledge' | 'optimization' | 'general' | 'web_search';
    confidence: number;
    suggestedTools: string[];
    keywords: string[];
    requiresMultipleTools: boolean;
    requiresWebSearch: boolean; // AI-determined need for external/real-time data
    searchReason?: string; // Why web search is needed
}

export interface ToolSelectionResult {
    selectedTools: Array<{
        name: string;
        reason: string;
        priority: number;
        parameters?: Record<string, any>;
    }>;
    executionOrder: string[];
    parallelizable: boolean;
}

export interface MultiLlmResponse {
    analysis: QueryAnalysis;
    toolSelection: ToolSelectionResult;
    finalResponse: string;
    confidence: number;
    executionTime: number;
}

export class MultiLlmOrchestratorService {
    private fastLlm: ChatBedrockConverse; // Nova Lite - Fast analysis
    private smartLlm: ChatBedrockConverse; // Claude 3.5 Sonnet - Tool selection
    private qualityLlm: ChatBedrockConverse; // Claude 4 Opus - Final response

    constructor() {
        // Fast LLM for quick analysis (Nova Lite)
        this.fastLlm = new ChatBedrockConverse({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: 'amazon.nova-lite-v1:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.3,
            maxTokens: 1000,
        });

        // Smart LLM for tool selection (Claude 3.5 Sonnet)
        this.smartLlm = new ChatBedrockConverse({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.2,
            maxTokens: 2000,
        });

        // Quality LLM for final response (Claude 3.5 Sonnet)
        this.qualityLlm = new ChatBedrockConverse({
            region: process.env.AWS_BEDROCK_REGION || 'us-east-1',
            model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.3,
            maxTokens: 4000,
        });

        loggingService.info('🤖 Multi-LLM Orchestrator initialized with 3 specialized models');
    }

    /**
     * Stage 1: Analyze query intent using fast LLM
     */
    async analyzeQuery(query: string): Promise<QueryAnalysis> {
        try {
            loggingService.info('📊 Stage 1: Analyzing query with fast LLM', { query: query.substring(0, 100) });

            const analysisPrompt = `Analyze this user query and provide structured analysis:

Query: "${query}"

Respond with JSON containing:
{
  "intent": "what the user wants to do",
  "category": "vercel|analytics|knowledge|optimization|web_search|general",
  "confidence": 0.0-1.0,
  "suggestedTools": ["tool1", "tool2"],
  "keywords": ["keyword1", "keyword2"],
  "requiresMultipleTools": true/false,
  "requiresWebSearch": true/false,
  "searchReason": "explanation if web search is needed"
}

Categories:
- vercel: Vercel deployment, projects, domains, environment variables
- analytics: Cost analysis, token usage, trends, patterns
- knowledge: How-to, documentation, best practices
- optimization: Cost optimization, performance improvement
- web_search: External real-time information, current events, latest news
- general: Other queries

Web Search Decision (requiresWebSearch):
Set requiresWebSearch to TRUE ONLY when the query explicitly needs:
1. Real-time/current information (e.g., "latest", "today's", "current", "recent news")
2. External web data not in our knowledge base (e.g., "search for", "find information about")
3. Time-sensitive data (e.g., "what happened today", "latest pricing changes")
4. Explicit search requests (e.g., "google search for", "look up")

Set requiresWebSearch to FALSE when:
1. Query is about CostKatana features, documentation, or internal data
2. Query asks about cloud pricing (use knowledge_base instead)
3. Query is vague or conversational (e.g., "tell me about that")
4. Query is about user's own analytics or projects

Respond ONLY with valid JSON, no markdown or extra text.`;

            const response = await this.fastLlm.invoke([
                { role: 'user', content: analysisPrompt }
            ]);

            let analysisText = response.content as string;
            
            // Remove markdown code fences if present
            analysisText = analysisText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            const analysis = JSON.parse(analysisText) as QueryAnalysis;

            loggingService.info('✅ Query analysis complete', {
                intent: analysis.intent,
                category: analysis.category,
                confidence: analysis.confidence,
                suggestedTools: analysis.suggestedTools
            });

            return analysis;
        } catch (error: any) {
            loggingService.error('❌ Query analysis failed', {
                error: error.message,
                query: query.substring(0, 100)
            });

            // Fallback analysis
            return {
                intent: 'general query',
                category: 'general',
                confidence: 0.5,
                suggestedTools: ['knowledge_base_search'],
                keywords: query.split(' ').slice(0, 5),
                requiresMultipleTools: false,
                requiresWebSearch: false
            };
        }
    }

    /**
     * Stage 2: Select best tools using smart LLM
     */
    async selectTools(
        query: string,
        analysis: QueryAnalysis,
        availableTools: Array<{ name: string; description: string }>
    ): Promise<ToolSelectionResult> {
        try {
            loggingService.info('🔧 Stage 2: Selecting tools with smart LLM', {
                category: analysis.category,
                suggestedTools: analysis.suggestedTools
            });

            const toolsDescription = availableTools
                .map(t => `- ${t.name}: ${t.description}`)
                .join('\n');

            const selectionPrompt = `Based on the query analysis, select the best tools to use:

Query: "${query}"
Analysis: ${JSON.stringify(analysis)}

Available Tools:
${toolsDescription}

Respond with JSON containing:
{
  "selectedTools": [
    {
      "name": "tool_name",
      "reason": "why this tool is needed",
      "priority": 1-10,
      "parameters": {"key": "value"}
    }
  ],
  "executionOrder": ["tool1", "tool2"],
  "parallelizable": true/false
}

Rules:
1. Select 1-3 most relevant tools
2. Higher priority = execute first
3. parallelizable = true if tools can run in parallel
4. Include specific parameters if known

Respond ONLY with valid JSON, no markdown or extra text.`;

            const response = await this.smartLlm.invoke([
                { role: 'user', content: selectionPrompt }
            ]);

            let selectionText = response.content as string;
            
            // Remove markdown code fences if present
            selectionText = selectionText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            
            const selection = JSON.parse(selectionText) as ToolSelectionResult;

            loggingService.info('✅ Tool selection complete', {
                selectedToolCount: selection.selectedTools.length,
                executionOrder: selection.executionOrder,
                parallelizable: selection.parallelizable
            });

            return selection;
        } catch (error: any) {
            loggingService.error('❌ Tool selection failed', {
                error: error.message,
                category: analysis.category
            });

            // Fallback selection
            return {
                selectedTools: [
                    {
                        name: 'knowledge_base_search',
                        reason: 'Default fallback tool',
                        priority: 1
                    }
                ],
                executionOrder: ['knowledge_base_search'],
                parallelizable: false
            };
        }
    }

    /**
     * Stage 3: Generate final response using quality LLM
     */
    async generateResponse(
        query: string,
        analysis: QueryAnalysis,
        toolResults: Array<{ toolName: string; result: any }>,
        context?: string
    ): Promise<string> {
        try {
            loggingService.info('✨ Stage 3: Generating response with quality LLM', {
                toolResultsCount: toolResults.length
            });

            const toolResultsText = toolResults
                .map(tr => `Tool: ${tr.toolName}\nResult: ${JSON.stringify(tr.result)}`)
                .join('\n\n');

            const responsePrompt = `Generate a comprehensive response to the user's query:

Query: "${query}"
Query Analysis: ${JSON.stringify(analysis)}
${context ? `Context: ${context}` : ''}

Tool Results:
${toolResultsText}

CRITICAL INSTRUCTIONS FOR INTERPRETING TOOL RESULTS:
1. Read the ACTUAL data from the tool results JSON
2. For vercel_list_projects tool:
   - Check the "count" field to see how many projects exist
   - If count > 0, list the actual project names from the "projects" array
   - If count = 0, then the user has no projects
3. NEVER make up or assume data - only use what's in the tool results

Guidelines:
1. Provide a clear, concise answer based on the ACTUAL tool results
2. Include specific data/numbers/names from the results
3. If the tool returned an error, explain it gracefully
4. Be accurate - don't say "0 projects" if the count shows otherwise
5. List actual project names when available
6. Provide actionable recommendations when relevant

Generate a natural, conversational response (not JSON).`;

            const response = await this.qualityLlm.invoke([
                { role: 'user', content: responsePrompt }
            ]);

            const finalResponse = response.content as string;

            loggingService.info('✅ Response generation complete', {
                responseLength: finalResponse.length
            });

            return finalResponse;
        } catch (error: any) {
            loggingService.error('❌ Response generation failed', {
                error: error.message
            });

            return 'I encountered an error generating a response. Please try again.';
        }
    }

    /**
     * Orchestrate the complete multi-LLM pipeline
     */
    async orchestrate(
        query: string,
        availableTools: Array<{ name: string; description: string }>,
        toolExecutor: (toolName: string, params?: Record<string, any>) => Promise<any>,
        context?: string
    ): Promise<MultiLlmResponse> {
        const startTime = Date.now();

        try {
            loggingService.info('🚀 Starting multi-LLM orchestration pipeline', {
                query: query.substring(0, 100)
            });

            // Stage 1: Analyze query
            const analysis = await this.analyzeQuery(query);

            // Stage 2: Select tools
            const toolSelection = await this.selectTools(query, analysis, availableTools);

            // Stage 3: Execute selected tools
            const toolResults: Array<{ toolName: string; result: any }> = [];

            if (toolSelection.parallelizable) {
                // Execute tools in parallel
                const parallelResults = await Promise.all(
                    toolSelection.selectedTools.map(tool =>
                        toolExecutor(tool.name, tool.parameters)
                            .then(result => ({ toolName: tool.name, result }))
                            .catch(error => ({
                                toolName: tool.name,
                                result: { error: error.message }
                            }))
                    )
                );
                toolResults.push(...parallelResults);
            } else {
                // Execute tools sequentially in priority order
                for (const tool of toolSelection.selectedTools.sort((a, b) => b.priority - a.priority)) {
                    try {
                        const result = await toolExecutor(tool.name, tool.parameters);
                        toolResults.push({ toolName: tool.name, result });
                    } catch (error: any) {
                        toolResults.push({
                            toolName: tool.name,
                            result: { error: error.message }
                        });
                    }
                }
            }

            // Stage 4: Generate final response
            const finalResponse = await this.generateResponse(query, analysis, toolResults, context);

            const executionTime = Date.now() - startTime;

            loggingService.info('✅ Multi-LLM orchestration complete', {
                executionTime,
                toolsExecuted: toolResults.length,
                responseLength: finalResponse.length
            });

            return {
                analysis,
                toolSelection,
                finalResponse,
                confidence: analysis.confidence,
                executionTime
            };
        } catch (error: any) {
            loggingService.error('❌ Multi-LLM orchestration failed', {
                error: error.message,
                query: query.substring(0, 100)
            });

            throw error;
        }
    }

    /**
     * Get model information
     */
    getModelInfo() {
        return {
            fastLlm: 'amazon.nova-lite-v1:0 (Fast analysis)',
            smartLlm: 'anthropic.claude-3-5-sonnet-20240620-v1:0 (Tool selection)',
            qualityLlm: 'anthropic.claude-3-5-sonnet-20240620-v1:0 (Final response)',
            pipeline: 'Query Analysis → Tool Selection → Tool Execution → Response Generation'
        };
    }
}

// Singleton instance
export const multiLlmOrchestratorService = new MultiLlmOrchestratorService();
