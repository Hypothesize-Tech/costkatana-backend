/**
 * AI-Powered Intent Router Service
 * 
 * Replaces regex-based routing with intelligent AI-driven query classification.
 * Uses a fast LLM (Nova Lite) for quick intent analysis and routing decisions.
 * 
 * Routes:
 * - knowledge_base: CostKatana documentation, features, how-to guides
 * - conversational_flow: General queries, Vercel commands, agent-handled tasks
 * - multi_agent: User analytics, cost analysis, complex multi-step tasks
 * - web_scraper: External information, news, real-time data
 * - integration: Direct integration commands (@vercel, @github, @linear, etc.)
 */

import { ChatBedrockConverse } from "@langchain/aws";
import { loggingService } from "./logging.service";

export type RouteType = 'knowledge_base' | 'conversational_flow' | 'multi_agent' | 'web_scraper' | 'integration';

export interface IntentAnalysis {
    route: RouteType;
    confidence: number;
    reasoning: string;
    detectedIntegration?: string;
    detectedCommand?: string;
    isVercelCommand: boolean;
    isKnowledgeBaseQuery: boolean;
    suggestedTools?: string[];
}

export interface RouterContext {
    lastDomain?: string;
    subjectConfidence?: number;
    currentSubject?: string;
    currentIntent?: string;
    useWebSearch?: boolean;
    hasVercelConnection?: boolean;
    hasGithubConnection?: boolean;
    recentMessages?: Array<{ role: string; content: string }>;
}

class AIIntentRouterService {
    private routerLlm: ChatBedrockConverse;
    private cache: Map<string, { result: IntentAnalysis; timestamp: number }> = new Map();
    private readonly CACHE_TTL = 60000; // 1 minute cache

    constructor() {
        // Use Nova Lite for fast routing decisions
        this.routerLlm = new ChatBedrockConverse({
            region: process.env.AWS_REGION ?? 'us-east-1',
            model: 'amazon.nova-lite-v1:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.1, // Low temperature for consistent routing
            maxTokens: 500,
        });

        loggingService.info('🧭 AI Intent Router initialized');
    }

    /**
     * Main routing method - analyzes query and returns optimal route
     */
    async analyzeIntent(
        message: string,
        context?: RouterContext
    ): Promise<IntentAnalysis> {
        const startTime = Date.now();
        
        // Extract actual query from enhanced message
        const actualQuery = this.extractActualQuery(message);
        
        // Check cache first
        const cacheKey = this.generateCacheKey(actualQuery, context);
        const cached = this.cache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < this.CACHE_TTL) {
            loggingService.info('🧭 Router cache hit', { route: cached.result.route });
            return cached.result;
        }

        // Handle explicit web search request
        if (context?.useWebSearch === true) {
            const result: IntentAnalysis = {
                route: 'web_scraper',
                confidence: 1.0,
                reasoning: 'Web search explicitly enabled by user',
                isVercelCommand: false,
                isKnowledgeBaseQuery: false
            };
            this.cache.set(cacheKey, { result, timestamp: Date.now() });
            return result;
        }

        try {
            // Use AI to analyze the query
            const result = await this.performAIAnalysis(actualQuery, context);
            
            // Cache the result
            this.cache.set(cacheKey, { result, timestamp: Date.now() });
            
            const duration = Date.now() - startTime;
            loggingService.info('🧭 AI Intent analysis complete', {
                route: result.route,
                confidence: result.confidence,
                reasoning: result.reasoning,
                isVercelCommand: result.isVercelCommand,
                duration
            });

            return result;
        } catch (error) {
            loggingService.error('AI Intent analysis failed, using fallback', {
                error: error instanceof Error ? error.message : String(error)
            });
            
            // Fallback to simple pattern matching if AI fails
            return this.fallbackAnalysis(actualQuery, context);
        }
    }

    /**
     * Perform AI-based intent analysis
     */
    private async performAIAnalysis(
        query: string,
        context?: RouterContext
    ): Promise<IntentAnalysis> {
        const contextInfo = context ? `
Context:
- Last domain: ${context.lastDomain || 'unknown'}
- Subject confidence: ${context.subjectConfidence || 0}
- Current subject: ${context.currentSubject || 'none'}
- Has Vercel connection: ${context.hasVercelConnection || false}
- Has GitHub connection: ${context.hasGithubConnection || false}
` : '';

        const prompt = `You are an intelligent query router for CostKatana, an AI cost optimization platform.

Analyze this query and determine the best routing destination.

Query: "${query}"
${contextInfo}

ROUTING RULES (follow strictly):

1. **integration** - MUST use for ANY query containing:
   - @vercel: commands (e.g., @vercel:list-projects, @vercel:list-domains)
   - @github: commands
   - @linear: commands
   - @slack: commands
   - Any @integration:command pattern

2. **knowledge_base** - Use for:
   - Questions about CostKatana platform itself
   - "What is CostKatana", "How does CostKatana work"
   - Documentation requests
   - Feature explanations
   - Setup guides, tutorials
   - Questions mentioning "costkatana", "cost katana", "cortex"

3. **web_scraper** - Use for:
   - External information not about CostKatana
   - Latest news, current events
   - Real-time data requests
   - Market information, pricing comparisons

4. **multi_agent** - Use for:
   - User's own analytics ("show my costs", "my usage")
   - Complex multi-step analysis
   - Data aggregation across multiple sources
   - Personalized recommendations based on user data

5. **conversational_flow** - DEFAULT for:
   - General questions
   - Casual conversation
   - Anything not fitting above categories

Respond with ONLY valid JSON (no markdown, no code fences):
{
  "route": "integration|knowledge_base|web_scraper|multi_agent|conversational_flow",
  "confidence": 0.0-1.0,
  "reasoning": "brief explanation",
  "detectedIntegration": "vercel|github|linear|slack|null",
  "detectedCommand": "list-projects|list-domains|etc|null",
  "isVercelCommand": true|false,
  "isKnowledgeBaseQuery": true|false,
  "suggestedTools": ["tool1", "tool2"]
}`;

        const response = await this.routerLlm.invoke(prompt);
        const content = response.content.toString().trim();
        
        // Clean response - remove markdown code fences if present
        let cleanedContent = content;
        if (cleanedContent.startsWith('```')) {
            cleanedContent = cleanedContent.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        
        try {
            const parsed = JSON.parse(cleanedContent);
            
            // Validate and normalize the response
            const validRoutes: RouteType[] = ['knowledge_base', 'conversational_flow', 'multi_agent', 'web_scraper', 'integration'];
            if (!validRoutes.includes(parsed.route)) {
                parsed.route = 'conversational_flow';
            }
            
            // Map 'integration' route to 'conversational_flow' since agent handles integrations
            if (parsed.route === 'integration') {
                parsed.route = 'conversational_flow';
            }
            
            return {
                route: parsed.route,
                confidence: Math.min(1, Math.max(0, parsed.confidence || 0.5)),
                reasoning: parsed.reasoning || 'AI analysis',
                detectedIntegration: parsed.detectedIntegration || undefined,
                detectedCommand: parsed.detectedCommand || undefined,
                isVercelCommand: parsed.isVercelCommand || false,
                isKnowledgeBaseQuery: parsed.isKnowledgeBaseQuery || false,
                suggestedTools: parsed.suggestedTools || []
            };
        } catch (parseError) {
            loggingService.warn('Failed to parse AI router response', { 
                content: cleanedContent,
                error: parseError instanceof Error ? parseError.message : String(parseError)
            });
            throw parseError;
        }
    }

    /**
     * Fallback analysis using simple pattern matching
     * Used when AI analysis fails
     */
    private fallbackAnalysis(query: string, _context?: RouterContext): IntentAnalysis {
        const lowerQuery = query.toLowerCase();
        
        // Check for integration commands first
        const integrationMatch = query.match(/@(vercel|github|linear|slack|discord|jira|gmail|calendar|drive|sheets|docs|slides|forms|google):?/i);
        if (integrationMatch) {
            const integration = integrationMatch[1].toLowerCase();
            const commandMatch = query.match(/@\w+:([a-z-]+)/i);
            
            return {
                route: 'conversational_flow',
                confidence: 0.95,
                reasoning: `Detected ${integration} integration command`,
                detectedIntegration: integration,
                detectedCommand: commandMatch ? commandMatch[1] : undefined,
                isVercelCommand: integration === 'vercel',
                isKnowledgeBaseQuery: false,
                suggestedTools: integration === 'vercel' ? ['vercel_list_projects', 'vercel_list_domains'] : []
            };
        }

        // Check for CostKatana knowledge base queries
        const costKatanaPatterns = [
            /cost\s*katana/i,
            /costkatana/i,
            /what\s+is\s+cost\s*katana/i,
            /tell\s+me\s+about\s+cost\s*katana/i,
            /cortex\s+optimization/i,
            /how\s+does\s+costkatana\s+work/i
        ];
        
        if (costKatanaPatterns.some(p => p.test(query))) {
            return {
                route: 'knowledge_base',
                confidence: 0.85,
                reasoning: 'Detected CostKatana-related query',
                isVercelCommand: false,
                isKnowledgeBaseQuery: true
            };
        }

        // Check for user analytics
        if (lowerQuery.includes('my ') && (
            lowerQuery.includes('cost') ||
            lowerQuery.includes('usage') ||
            lowerQuery.includes('billing') ||
            lowerQuery.includes('analytics')
        )) {
            return {
                route: 'multi_agent',
                confidence: 0.8,
                reasoning: 'Detected user analytics query',
                isVercelCommand: false,
                isKnowledgeBaseQuery: false
            };
        }

        // Check for web search indicators
        if (lowerQuery.includes('latest') || lowerQuery.includes('news') || lowerQuery.includes('current')) {
            return {
                route: 'web_scraper',
                confidence: 0.7,
                reasoning: 'Detected external information request',
                isVercelCommand: false,
                isKnowledgeBaseQuery: false
            };
        }

        // Default to conversational flow
        return {
            route: 'conversational_flow',
            confidence: 0.6,
            reasoning: 'Default routing for general query',
            isVercelCommand: false,
            isKnowledgeBaseQuery: false
        };
    }

    /**
     * Extract actual user query from enhanced message (removes context preamble)
     */
    private extractActualQuery(message: string): string {
        // Look for "User query:" pattern
        const userQueryMatch = message.match(/User query:\s*(.+?)(?:\n|$)/i);
        if (userQueryMatch) {
            return userQueryMatch[1].trim();
        }
        
        // Look for last line after context
        const lines = message.split('\n');
        const lastNonEmptyLine = lines.filter(l => l.trim()).pop();
        if (lastNonEmptyLine && !lastNonEmptyLine.includes(':') && lastNonEmptyLine.length < 500) {
            // Check if this looks like a query (not context)
            if (!lastNonEmptyLine.toLowerCase().startsWith('intent:') &&
                !lastNonEmptyLine.toLowerCase().startsWith('recent entities:') &&
                !lastNonEmptyLine.toLowerCase().startsWith('current subject:')) {
                return lastNonEmptyLine.trim();
            }
        }
        
        return message;
    }

    /**
     * Generate cache key for query + context
     */
    private generateCacheKey(query: string, context?: RouterContext): string {
        const contextKey = context ? 
            `${context.lastDomain || ''}-${context.useWebSearch || false}` : '';
        return `${query.toLowerCase().substring(0, 100)}-${contextKey}`;
    }

    /**
     * Check if a query is a Vercel command (quick check without full AI analysis)
     */
    isVercelCommand(message: string): boolean {
        const actualQuery = this.extractActualQuery(message);
        return /@vercel[:\s]/i.test(actualQuery);
    }

    /**
     * Check if a query is a knowledge base query (quick check without full AI analysis)
     */
    isKnowledgeBaseQuery(message: string): boolean {
        const actualQuery = this.extractActualQuery(message);
        const lowerQuery = actualQuery.toLowerCase();
        
        // First, exclude integration commands
        if (/@(vercel|github|linear|slack|discord|jira)[:\s]/i.test(actualQuery)) {
            return false;
        }
        
        // Check for CostKatana patterns
        return /cost\s*katana/i.test(actualQuery) ||
               /costkatana/i.test(actualQuery) ||
               lowerQuery.includes('@knowledge-base') ||
               lowerQuery.includes('knowledge base');
    }

    /**
     * Clear the cache (useful for testing)
     */
    clearCache(): void {
        this.cache.clear();
    }
}

// Export singleton instance
export const aiIntentRouter = new AIIntentRouterService();
