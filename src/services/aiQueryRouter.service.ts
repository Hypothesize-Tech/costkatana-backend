/**
 * AI Query Router Service
 * Intelligent routing of user queries to appropriate handlers using AI
 * Replaces regex-based and hardcoded routing with AI-powered decisions
 */

import { ChatBedrockConverse } from "@langchain/aws";
import { loggingService } from "./logging.service";

export type RouteType = 
    | 'vercel_tools'           // Vercel-specific operations
    | 'github_tools'           // GitHub-specific operations
    | 'google_tools'           // Google services (Drive, Docs, Sheets, etc.)
    | 'knowledge_base'         // CostKatana documentation and help
    | 'analytics'              // Cost analytics and usage data
    | 'optimization'           // Cost optimization recommendations
    | 'web_search'             // External web search
    | 'multi_agent'            // Complex multi-step operations
    | 'direct_response';       // Simple conversational responses

export interface RoutingDecision {
    route: RouteType;
    confidence: number;
    reasoning: string;
    suggestedTools: string[];
    extractedParams: Record<string, any>;
    requiresIntegration: boolean;
    integrationName?: string;
}

export interface RouterContext {
    userId: string;
    hasVercelConnection?: boolean;
    hasGithubConnection?: boolean;
    hasGoogleConnection?: boolean;
    previousMessages?: Array<{ role: string; content: string }>;
    conversationSubject?: string;
}

export class AIQueryRouterService {
    private routerLlm: ChatBedrockConverse;
    private static instance: AIQueryRouterService;

    private constructor() {
        // Use Claude 3.5 Haiku for fast, accurate routing decisions
        this.routerLlm = new ChatBedrockConverse({
            region: process.env.AWS_REGION ?? 'us-east-1',
            model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
            credentials: {
                accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
                secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
            },
            temperature: 0.1, // Low temperature for consistent routing
            maxTokens: 1500,
        });

        loggingService.info('🧠 AI Query Router initialized');
    }

    static getInstance(): AIQueryRouterService {
        if (!AIQueryRouterService.instance) {
            AIQueryRouterService.instance = new AIQueryRouterService();
        }
        return AIQueryRouterService.instance;
    }

    /**
     * Route a query to the appropriate handler using AI
     */
    async routeQuery(query: string, context: RouterContext): Promise<RoutingDecision> {
        const startTime = Date.now();

        try {
            loggingService.info('🔀 AI Router analyzing query', {
                queryPreview: query.substring(0, 100),
                userId: context.userId,
                hasVercel: context.hasVercelConnection,
                hasGithub: context.hasGithubConnection,
                hasGoogle: context.hasGoogleConnection
            });

            const routingPrompt = this.buildRoutingPrompt(query, context);
            
            const response = await this.routerLlm.invoke([
                { role: 'user', content: routingPrompt }
            ]);

            let responseText = response.content as string;
            
            // Clean up response - remove markdown code fences if present
            responseText = responseText
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();

            const decision = JSON.parse(responseText) as RoutingDecision;

            const latency = Date.now() - startTime;
            loggingService.info('✅ AI Router decision', {
                route: decision.route,
                confidence: decision.confidence,
                reasoning: decision.reasoning,
                latencyMs: latency
            });

            return decision;

        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            loggingService.error('❌ AI Router failed, using fallback', {
                error: errorMessage,
                query: query.substring(0, 100)
            });

            // Intelligent fallback based on query patterns
            return this.fallbackRouting(query, context);
        }
    }

    /**
     * Build the routing prompt with context
     */
    private buildRoutingPrompt(query: string, context: RouterContext): string {
        const integrationStatus = [];
        if (context.hasVercelConnection) integrationStatus.push('Vercel: CONNECTED');
        if (context.hasGithubConnection) integrationStatus.push('GitHub: CONNECTED');
        if (context.hasGoogleConnection) integrationStatus.push('Google: CONNECTED');

        const previousContext = context.previousMessages?.length 
            ? `\nRecent conversation:\n${context.previousMessages.slice(-3).map(m => `${m.role}: ${m.content}`).join('\n')}`
            : '';

        return `You are an intelligent query router for CostKatana, an AI cost optimization platform.
Analyze the user's query and determine the best route to handle it.

USER QUERY: "${query}"

AVAILABLE INTEGRATIONS:
${integrationStatus.length > 0 ? integrationStatus.join('\n') : 'No integrations connected'}
${previousContext}

AVAILABLE ROUTES:
1. vercel_tools - For Vercel operations: list projects, deployments, domains, env vars, logs, redeploy
   - Triggers: @vercel, "vercel projects", "my deployments", "vercel domains", etc.
   - ONLY use if user explicitly mentions Vercel or uses @vercel

2. github_tools - For GitHub operations: repos, PRs, issues, code
   - Triggers: @github, "github repos", "pull requests", "issues", etc.
   - ONLY use if user explicitly mentions GitHub or uses @github

3. google_tools - For Google services: Drive, Docs, Sheets, Calendar, Gmail
   - Triggers: @google, @drive, @docs, @sheets, @calendar, @gmail
   - ONLY use if user explicitly mentions Google services

4. knowledge_base - For CostKatana documentation, features, how-to guides
   - Triggers: Questions about CostKatana, "how to use", "what is costkatana", features, pricing
   - Use for product documentation and help

5. analytics - For cost analytics, usage data, spending trends
   - Triggers: "my costs", "spending", "usage analytics", "token usage", cost breakdown
   - Use for user's own analytics data

6. optimization - For cost optimization recommendations
   - Triggers: "optimize costs", "reduce spending", "save money", "recommendations"
   - Use for optimization suggestions

7. web_search - For external information, news, current events
   - Triggers: "search for", "latest news", "current price of", external topics
   - Use when user needs external/real-time information

8. multi_agent - For complex multi-step operations
   - Triggers: Complex requests requiring multiple tools or steps
   - Use for sophisticated workflows

9. direct_response - For simple conversational responses
   - Triggers: Greetings, simple questions, clarifications
   - Use when no tools are needed

ROUTING RULES:
1. If query contains "@vercel" or explicitly mentions Vercel operations → vercel_tools
2. If query contains "@github" or explicitly mentions GitHub → github_tools
3. If query contains "@google", "@drive", "@docs", "@sheets" → google_tools
4. If query asks about CostKatana features, documentation, or how-to → knowledge_base
5. If query asks about user's own costs, usage, or analytics → analytics
6. If query asks for optimization recommendations → optimization
7. If query needs external/real-time information → web_search
8. If query is complex and needs multiple tools → multi_agent
9. If query is simple greeting or conversation → direct_response

IMPORTANT:
- DO NOT route to vercel_tools unless user explicitly mentions Vercel
- DO NOT route to github_tools unless user explicitly mentions GitHub
- CostKatana projects are NOT the same as Vercel projects
- "my projects" without context = analytics (CostKatana projects)
- "@vercel list projects" = vercel_tools (Vercel projects)

Respond with JSON only:
{
    "route": "one of the route types",
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation of why this route was chosen",
    "suggestedTools": ["list", "of", "relevant", "tools"],
    "extractedParams": {"any": "parameters extracted from query"},
    "requiresIntegration": true/false,
    "integrationName": "vercel|github|google|null"
}`;
    }

    /**
     * Fallback routing when AI fails
     * Uses simple pattern matching as a safety net
     */
    private fallbackRouting(query: string, _context: RouterContext): RoutingDecision {
        const lowerQuery = query.toLowerCase();

        // Check for explicit integration mentions
        if (lowerQuery.includes('@vercel') || 
            (lowerQuery.includes('vercel') && (
                lowerQuery.includes('project') ||
                lowerQuery.includes('deploy') ||
                lowerQuery.includes('domain') ||
                lowerQuery.includes('env')
            ))) {
            return {
                route: 'vercel_tools',
                confidence: 0.8,
                reasoning: 'Fallback: Detected Vercel-related keywords',
                suggestedTools: ['vercel_list_projects'],
                extractedParams: {},
                requiresIntegration: true,
                integrationName: 'vercel'
            };
        }

        if (lowerQuery.includes('@github') || 
            (lowerQuery.includes('github') && (
                lowerQuery.includes('repo') ||
                lowerQuery.includes('pull request') ||
                lowerQuery.includes('issue') ||
                lowerQuery.includes('pr')
            ))) {
            return {
                route: 'github_tools',
                confidence: 0.8,
                reasoning: 'Fallback: Detected GitHub-related keywords',
                suggestedTools: ['github_list_repos'],
                extractedParams: {},
                requiresIntegration: true,
                integrationName: 'github'
            };
        }

        if (lowerQuery.includes('@google') || 
            lowerQuery.includes('@drive') || 
            lowerQuery.includes('@docs') ||
            lowerQuery.includes('@sheets') ||
            lowerQuery.includes('@calendar') ||
            lowerQuery.includes('@gmail')) {
            return {
                route: 'google_tools',
                confidence: 0.8,
                reasoning: 'Fallback: Detected Google services keywords',
                suggestedTools: ['google_drive_list'],
                extractedParams: {},
                requiresIntegration: true,
                integrationName: 'google'
            };
        }

        // CostKatana documentation queries
        if (lowerQuery.includes('costkatana') || 
            lowerQuery.includes('cost katana') ||
            lowerQuery.includes('how to use') ||
            lowerQuery.includes('what is') ||
            lowerQuery.includes('documentation') ||
            lowerQuery.includes('feature')) {
            return {
                route: 'knowledge_base',
                confidence: 0.7,
                reasoning: 'Fallback: Detected documentation/help keywords',
                suggestedTools: ['knowledge_base_search'],
                extractedParams: {},
                requiresIntegration: false
            };
        }

        // Analytics queries
        if (lowerQuery.includes('my cost') || 
            lowerQuery.includes('my usage') ||
            lowerQuery.includes('spending') ||
            lowerQuery.includes('analytics')) {
            return {
                route: 'analytics',
                confidence: 0.7,
                reasoning: 'Fallback: Detected analytics keywords',
                suggestedTools: ['analytics_query'],
                extractedParams: {},
                requiresIntegration: false
            };
        }

        // Web search
        if (lowerQuery.includes('search for') || 
            lowerQuery.includes('latest news') ||
            lowerQuery.includes('current price')) {
            return {
                route: 'web_search',
                confidence: 0.7,
                reasoning: 'Fallback: Detected web search keywords',
                suggestedTools: ['web_search'],
                extractedParams: {},
                requiresIntegration: false
            };
        }

        // Default to direct response for simple queries
        return {
            route: 'direct_response',
            confidence: 0.5,
            reasoning: 'Fallback: No specific pattern detected, using direct response',
            suggestedTools: [],
            extractedParams: {},
            requiresIntegration: false
        };
    }

    /**
     * Determine if a query requires a specific integration
     */
    requiresIntegration(query: string): { required: boolean; integration?: string } {
        const lowerQuery = query.toLowerCase();

        // Quick check for explicit integration mentions
        if (lowerQuery.includes('@vercel') || 
            (lowerQuery.includes('vercel') && !lowerQuery.includes('costkatana'))) {
            return { required: true, integration: 'vercel' };
        }

        if (lowerQuery.includes('@github') || 
            (lowerQuery.includes('github') && !lowerQuery.includes('costkatana'))) {
            return { required: true, integration: 'github' };
        }

        if (lowerQuery.includes('@google') || 
            lowerQuery.includes('@drive') || 
            lowerQuery.includes('@docs') ||
            lowerQuery.includes('@sheets')) {
            return { required: true, integration: 'google' };
        }

        return { required: false };
    }

    /**
     * Check if query is asking about CostKatana vs external service
     */
    isCostKatanaQuery(query: string): boolean {
        const lowerQuery = query.toLowerCase();

        // Explicit CostKatana mentions
        if (lowerQuery.includes('costkatana') || lowerQuery.includes('cost katana')) {
            return true;
        }

        // Check for integration mentions (not CostKatana)
        const integrationPatterns = ['@vercel', '@github', '@google', '@drive', '@docs', '@sheets'];
        if (integrationPatterns.some(p => lowerQuery.includes(p))) {
            return false;
        }

        // "my projects" without context could be either - default to CostKatana
        if (lowerQuery.includes('my project') && !lowerQuery.includes('vercel') && !lowerQuery.includes('github')) {
            return true;
        }

        return false;
    }
}

// Export singleton instance
export const aiQueryRouter = AIQueryRouterService.getInstance();
