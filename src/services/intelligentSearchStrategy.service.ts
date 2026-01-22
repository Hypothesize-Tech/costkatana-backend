import { loggingService } from './logging.service';
import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';

/**
 * Search Strategy Types
 */
export enum SearchStrategy {
    MMR = 'mmr',              // Maximal Marginal Relevance - for general, broad queries
    COSINE = 'cosine',        // Cosine Similarity - for focused, complex, specific queries
    HYBRID = 'hybrid'         // Combination of both
}

/**
 * Query Complexity Analysis Result
 */
export interface QueryAnalysis {
    complexity: 'simple' | 'moderate' | 'complex';
    specificity: 'general' | 'focused' | 'specific';
    recommendedStrategy: SearchStrategy;
    confidence: number; // 0-1 score
    reasoning: string[];
    queryFeatures: {
        length: number;
        technicalTerms: number;
        entities: number;
        questionType: string;
        hasComparison: boolean;
        hasConstraints: boolean;
        hasSpatialTemporal: boolean;
    };
}

/**
 * Search Configuration based on strategy
 */
export interface SearchConfig {
    strategy: SearchStrategy;
    k: number;
    fetchK?: number;
    lambda?: number;
    threshold?: number;
}

/**
 * Intelligent Search Strategy Service
 * Uses AI (AWS Bedrock) to autonomously decide between MMR and Cosine Similarity
 * 
 * Strategy Decision Logic:
 * - MMR: For general, exploratory, broad queries (high diversity needed)
 * - Cosine: For specific, technical, focused queries (high precision needed)
 * - Hybrid: For complex queries requiring both diversity and precision
 * 
 * The AI model analyzes the query semantically and makes intelligent decisions
 * without relying on keyword matching or rule-based systems.
 */
export class IntelligentSearchStrategyService {
    private static bedrockClient: BedrockRuntimeClient;
    private static readonly FAST_MODEL_ID = 'anthropic.claude-3-5-sonnet-20241022-v2:0'; 

    /**
     * Initialize Bedrock client
     */
    private static getBedrockClient(): BedrockRuntimeClient {
        if (!this.bedrockClient) {
            this.bedrockClient = new BedrockRuntimeClient({
                region: process.env.AWS_REGION || 'us-east-1'
            });
        }
        return this.bedrockClient;
    }

    /**
     * Analyze query using AI (AWS Bedrock) to determine optimal search strategy
     * The AI model makes autonomous decisions based on semantic understanding
     */
    static async analyzeQuery(query: string): Promise<QueryAnalysis> {
        const startTime = Date.now();

        try {
            loggingService.info('🤖 Using AI to analyze query for intelligent search strategy', {
                component: 'IntelligentSearchStrategy',
                operation: 'analyzeQuery',
                queryLength: query.length,
                model: this.FAST_MODEL_ID
            });

            // Construct the AI prompt for strategy decision
            const systemPrompt = `You are an expert search strategy analyzer for a RAG (Retrieval Augmented Generation) system. Your job is to analyze user queries and recommend the optimal vector search strategy.

**Available Strategies:**

1. **MMR (Maximal Marginal Relevance)**
   - Best for: General, exploratory, broad queries
   - Purpose: Provides diverse results with different perspectives
   - Example queries: "Tell me about AI costs", "What are the options for...", "Overview of..."

2. **COSINE (Cosine Similarity)**
   - Best for: Specific, focused, technical queries with clear intent
   - Purpose: Provides precise, highly relevant results
   - Example queries: "How to configure API endpoint X", "Find documentation for function Y", "Exact pricing for model Z"

3. **HYBRID (Combination)**
   - Best for: Complex queries needing both precision and diversity
   - Purpose: Balances between relevance and coverage
   - Example queries: "Compare X vs Y", "Analyze the trade-offs of...", "Which is better for..."

**Your Task:**
Analyze the user's query semantically and recommend the best strategy. Consider:
- Query intent and goal
- Level of specificity vs generality
- Need for diverse perspectives vs precise answers
- Complexity of the question
- Domain and context

Respond ONLY with valid JSON in this exact format (no markdown, no code blocks):
{
  "complexity": "simple|moderate|complex",
  "specificity": "general|focused|specific",
  "recommendedStrategy": "mmr|cosine|hybrid",
  "confidence": 0.85,
  "reasoning": ["reason 1", "reason 2", "reason 3"],
  "queryFeatures": {
    "length": 50,
    "technicalTerms": 2,
    "entities": 1,
    "questionType": "exploratory|specific|what|how|why|when|where|who|statement",
    "hasComparison": false,
    "hasConstraints": false,
    "hasSpatialTemporal": false
  }
}`;

            const userPrompt = `Analyze this user query and recommend the optimal search strategy:

Query: "${query}"

Think carefully about:
1. Is this a broad, exploratory question (→ MMR for diversity)?
2. Is this a specific, targeted question (→ COSINE for precision)?
3. Is this complex and needs both perspectives (→ HYBRID)?

Provide your analysis in JSON format.`;

            // Call Bedrock AI model
            const client = this.getBedrockClient();
            const command = new InvokeModelCommand({
                modelId: this.FAST_MODEL_ID,
                contentType: 'application/json',
                accept: 'application/json',
                body: JSON.stringify({
                    anthropic_version: 'bedrock-2023-05-31',
                    max_tokens: 1000,
                    temperature: 0.3, // Low temperature for consistent, logical decisions
                    system: systemPrompt,
                    messages: [
                        {
                            role: 'user',
                            content: userPrompt
                        }
                    ]
                })
            });

            const response = await client.send(command);
            const responseBody = JSON.parse(new TextDecoder().decode(response.body));
            
            // Extract AI response
            let aiResponseText = '';
            if (responseBody.content && responseBody.content[0]?.text) {
                aiResponseText = responseBody.content[0].text.trim();
            } else {
                throw new Error('Invalid response format from Bedrock');
            }

            loggingService.info('🧠 AI response received', {
                component: 'IntelligentSearchStrategy',
                responseLength: aiResponseText.length,
                inputTokens: responseBody.usage?.input_tokens,
                outputTokens: responseBody.usage?.output_tokens
            });

            // Parse AI response (handle potential markdown code blocks)
            let analysis: QueryAnalysis;
            try {
                // Remove markdown code blocks if present
                const jsonMatch = aiResponseText.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
                const jsonText = jsonMatch ? jsonMatch[1] : aiResponseText;
                
                const parsed = JSON.parse(jsonText);
                
                // Validate and construct analysis
                analysis = {
                    complexity: parsed.complexity || 'moderate',
                    specificity: parsed.specificity || 'focused',
                    recommendedStrategy: parsed.recommendedStrategy as SearchStrategy || SearchStrategy.COSINE,
                    confidence: parsed.confidence || 0.7,
                    reasoning: Array.isArray(parsed.reasoning) ? parsed.reasoning : ['AI analysis completed'],
                    queryFeatures: {
                        length: query.length,
                        technicalTerms: parsed.queryFeatures?.technicalTerms || 0,
                        entities: parsed.queryFeatures?.entities || 0,
                        questionType: parsed.queryFeatures?.questionType || 'unknown',
                        hasComparison: parsed.queryFeatures?.hasComparison || false,
                        hasConstraints: parsed.queryFeatures?.hasConstraints || false,
                        hasSpatialTemporal: parsed.queryFeatures?.hasSpatialTemporal || false
                    }
                };

                // Add AI attribution to reasoning
                analysis.reasoning.unshift('🤖 Analysis performed by AI (Claude 3 Haiku)');

            } catch (parseError) {
                loggingService.error('Failed to parse AI response, using fallback', {
                    component: 'IntelligentSearchStrategy',
                    error: parseError instanceof Error ? parseError.message : String(parseError),
                    rawResponse: aiResponseText.substring(0, 200)
                });

                // Fallback: Extract strategy from text if JSON parsing fails
                const strategyMatch = aiResponseText.toLowerCase();
                let strategy = SearchStrategy.COSINE; // Safe default
                
                if (strategyMatch.includes('mmr') || strategyMatch.includes('marginal relevance')) {
                    strategy = SearchStrategy.MMR;
                } else if (strategyMatch.includes('hybrid') || strategyMatch.includes('combination')) {
                    strategy = SearchStrategy.HYBRID;
                }

                analysis = {
                    complexity: 'moderate',
                    specificity: 'focused',
                    recommendedStrategy: strategy,
                    confidence: 0.6,
                    reasoning: [
                        '🤖 AI analysis completed (fallback parsing)',
                        aiResponseText.substring(0, 150)
                    ],
                    queryFeatures: {
                        length: query.length,
                        technicalTerms: 0,
                        entities: 0,
                        questionType: 'unknown',
                        hasComparison: false,
                        hasConstraints: false,
                        hasSpatialTemporal: false
                    }
                };
            }

            const duration = Date.now() - startTime;

            loggingService.info('✅ AI-powered query analysis completed', {
                component: 'IntelligentSearchStrategy',
                operation: 'analyzeQuery',
                duration,
                complexity: analysis.complexity,
                specificity: analysis.specificity,
                strategy: analysis.recommendedStrategy,
                confidence: analysis.confidence.toFixed(3),
                aiModel: this.FAST_MODEL_ID
            });

            return analysis;

        } catch (error) {
            loggingService.error('❌ AI query analysis failed, using fallback', {
                component: 'IntelligentSearchStrategy',
                operation: 'analyzeQuery',
                error: error instanceof Error ? error.message : String(error)
            });

            // Fallback to cosine similarity (safer default)
            return {
                complexity: 'moderate',
                specificity: 'focused',
                recommendedStrategy: SearchStrategy.COSINE,
                confidence: 0.5,
                reasoning: [
                    'AI analysis failed - using safe default (Cosine Similarity)',
                    error instanceof Error ? error.message : String(error)
                ],
                queryFeatures: {
                    length: query.length,
                    technicalTerms: 0,
                    entities: 0,
                    questionType: 'unknown',
                    hasComparison: false,
                    hasConstraints: false,
                    hasSpatialTemporal: false
                }
            };
        }
    }

    /**
     * Get search configuration based on strategy
     */
    static getSearchConfig(
        strategy: SearchStrategy,
        complexity: 'simple' | 'moderate' | 'complex'
    ): SearchConfig {
        const baseK = complexity === 'complex' ? 10 : complexity === 'moderate' ? 6 : 4;

        switch (strategy) {
            case SearchStrategy.MMR:
                return {
                    strategy: SearchStrategy.MMR,
                    k: baseK,
                    fetchK: baseK * 5, // Fetch 5x more candidates for diversity
                    lambda: 0.5 // Balance between relevance and diversity
                };

            case SearchStrategy.COSINE:
                return {
                    strategy: SearchStrategy.COSINE,
                    k: baseK,
                    threshold: 0.7 // Minimum similarity threshold
                };

            case SearchStrategy.HYBRID:
                return {
                    strategy: SearchStrategy.HYBRID,
                    k: baseK,
                    fetchK: baseK * 3,
                    lambda: 0.7, // Favor relevance over diversity
                    threshold: 0.6
                };

            default:
                return {
                    strategy: SearchStrategy.COSINE,
                    k: baseK,
                    threshold: 0.7
                };
        }
    }


    /**
     * Explain strategy selection to users (for debugging/transparency)
     */
    static explainStrategy(analysis: QueryAnalysis): string {
        return `
🤖 **Intelligent Search Strategy Analysis**

**Query Characteristics:**
- Complexity: ${analysis.complexity.toUpperCase()}
- Specificity: ${analysis.specificity.toUpperCase()}
- Length: ${analysis.queryFeatures.length} characters
- Technical Terms: ${analysis.queryFeatures.technicalTerms}
- Entities: ${analysis.queryFeatures.entities}
- Question Type: ${analysis.queryFeatures.questionType}

**Selected Strategy: ${analysis.recommendedStrategy.toUpperCase()}**
- Confidence: ${(analysis.confidence * 100).toFixed(1)}%

**Reasoning:**
${analysis.reasoning.map((r, i) => `${i + 1}. ${r}`).join('\n')}

**Strategy Explanation:**
${this.getStrategyExplanation(analysis.recommendedStrategy)}
        `.trim();
    }

    /**
     * Get strategy explanation
     */
    private static getStrategyExplanation(strategy: SearchStrategy): string {
        switch (strategy) {
            case SearchStrategy.MMR:
                return '📊 MMR (Maximal Marginal Relevance) provides diverse results by balancing relevance with novelty. Best for exploratory queries where you want to see different perspectives.';
            
            case SearchStrategy.COSINE:
                return '🎯 Cosine Similarity provides precise, highly relevant results. Best for specific queries where you know exactly what you\'re looking for.';
            
            case SearchStrategy.HYBRID:
                return '⚡ Hybrid approach combines both precision and diversity. Best for complex queries that need comprehensive coverage.';
            
            default:
                return 'Standard similarity search.';
        }
    }
}

export default IntelligentSearchStrategyService;
