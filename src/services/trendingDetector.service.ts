import { loggingService } from './logging.service';
import { ChatBedrockConverse } from "@langchain/aws";
import { AICostTrackingService } from './aiCostTracking.service';

export interface TrendingQuery {
    needsRealTimeData: boolean;
    confidence: number;
    suggestedSources: string[];
    queryType: 'trending' | 'pricing' | 'news' | 'social' | 'tech' | 'weather' | 'health' | 'travel' | 'shopping' | 'reverse_search' | 'professional' | 'ai_models' | 'ai_pricing' | 'ai_news' | 'general';
    extractionStrategy: {
        selectors: Record<string, string>;
        waitFor?: string;
        javascript?: boolean;
    };
    cacheStrategy: {
        ttl: number; // seconds
        refreshTriggers: string[];
    };
}

export class TrendingDetectorService {
    private classifier: ChatBedrockConverse;
    
    // Patterns that indicate real-time data needs
    private readonly realTimePatterns = [
        // General knowledge queries (catch-all)
        /what\s+is|how\s+to|where\s+is|when\s+is|who\s+is/i,
        /tell\s+me\s+about|show\s+me|find\s+me/i,
        /what's\s+the|what\s+are\s+the|what\s+do\s+you\s+know/i,
        
        // Trending/Popular content
        /trending|popular|hot|viral|top\s+\d+/i,
        /what's\s+(hot|new|trending|popular)/i,
        /latest\s+(news|updates|releases)/i,
        
        // Price queries
        /price|cost|deal|discount|sale|offer/i,
        /how\s+much|cheapest|expensive/i,
        
        // Social media / community
        /reddit|twitter|hacker\s+news|product\s+hunt/i,
        /discussion|comments|reviews/i,
        
        // Tech/startup queries  
        /github\s+trending|new\s+tools|startup/i,
        /ai\s+tools|saas|app/i,
        
        // AI-specific queries
        /ai\s+models?|llm|large\s+language\s+model/i,
        /openai|anthropic|claude|gpt|gemini|llama|mistral|cohere|perplexity|fireworks|groq|cerebras|deepinfra|anyscale|baseten|modal|runpod|lepton|novita|banana\s+dev|vllm|langchain|llamaindex|pinecone|weaviate|qdrant|milvus|aws\s+bedrock|azure\s+openai|vertex\s+ai|google\s+cloud\s+ai/i,
        /model\s+pricing|ai\s+pricing|token\s+cost/i,
        /ai\s+news|artificial\s+intelligence\s+news/i,
        /machine\s+learning|deep\s+learning|neural\s+network/i,
        /chatgpt|bard|copilot|midjourney|stable\s+diffusion/i,
        
        // Additional AI providers and tools
        /hugging\s+face|huggingface|ollama|replicate/i,
        /together\s+ai|fireworks\s+ai|groq|cerebras/i,
        /perplexity|deepinfra|anyscale|baseten/i,
        /modal|runpod|lepton|novita|banana\s+dev/i,
        /vllm|langchain|llamaindex|pinecone|weaviate|qdrant|milvus/i,
        /aws\s+bedrock|azure\s+openai|vertex\s+ai|google\s+cloud\s+ai/i,
        
        // Weather queries
        /weather|temperature|forecast|climate/i,
        /what's\s+the\s+weather|how\s+hot|cold/i,
        
        // Time-sensitive queries
        /today|now|current|recent|this\s+week/i,
        /live|real[- ]?time|up[- ]?to[- ]?date/i,
        
        // Location-based queries
        /in\s+\w+|at\s+\w+|near\s+\w+/i,
        
        // Comparison queries
        /compare|vs|versus|difference\s+between/i,
        
        // How-to and tutorial queries
        /how\s+to|tutorial|guide|steps/i,
        
        // Life utility queries
        /what\s+should\s+i\s+wear|clothing\s+advice|dress\s+for/i,
        /symptoms|headache|fever|cough|pain|health/i,
        /travel\s+to|flight\s+to|train\s+to|book\s+ticket/i,
        /price\s+of|cost\s+of|track\s+price|price\s+drop/i,
        /identify\s+this|what\s+is\s+this|reverse\s+search/i,
        
        // Shopping/product queries
        /do\s+you\s+have|available\s+on|find\s+me|looking\s+for/i,
        /buy|purchase|shop|order|get\s+me/i,
        /microphone|mic|headphones|laptop|phone|camera/i,
        /under\s+\d+|below\s+\d+|less\s+than\s+\d+|budget\s+of/i,
        /on\s+amazon|on\s+flipkart|on\s+myntra|e-commerce/i,
    ];

    // Known sources for different content types
    private readonly sourceMapping = {
        trending_tech: [
            'https://news.ycombinator.com/',
            'https://github.com/trending',
            'https://www.producthunt.com/'
        ],
        pricing: [
            'https://www.amazon.com/',
            'https://www.amazon.in/',
            'https://www.flipkart.com/',
            'https://www.ebay.com/'
        ],
        news: [
            'https://techcrunch.com/',
            'https://www.theverge.com/',
            'https://arstechnica.com/'
        ],
        social: [
            'https://www.reddit.com/',
            'https://news.ycombinator.com/'
        ],
        weather: [
            'https://www.weather.gov/',
            'https://www.wunderground.com/',
            'https://www.accuweather.com/',
            'https://weather.com/',
            'https://www.google.com/search?q=weather+bengaluru'
        ],
        general: [
            'https://www.google.com/search',
            'https://www.bing.com/search',
            'https://www.wikipedia.org/',
            'https://www.reddit.com/',
            'https://stackoverflow.com/'
        ],
        professional: [
            'https://www.linkedin.com/',
            'https://www.crunchbase.com/',
            'https://about.me/',
            'https://www.xing.com/'
        ],
        ai_models: [
            // Major Providers
            'https://platform.openai.com/docs/models',
            'https://docs.anthropic.com/claude/docs/models-overview',
            'https://ai.google.dev/models/gemini',
            'https://docs.cohere.com/docs/models',
            'https://docs.mistral.ai/platform/endpoints/',
            
            // Open Source & Community
            'https://huggingface.co/models',
            'https://ollama.ai/library',
            'https://github.com/ggerganov/llama.cpp',
            'https://github.com/Mozilla-Ocho/llamafile',
            
            // Cloud Providers
            'https://docs.aws.amazon.com/bedrock/latest/userguide/models-supported.html',
            'https://learn.microsoft.com/en-us/azure/ai-services/openai/concepts/models',
            'https://cloud.google.com/vertex-ai/docs/generative-ai/learn/models',
            
            // Specialized Providers
            'https://replicate.com/explore',
            'https://www.together.ai/models',
            'https://docs.perplexity.ai/docs/model-cards',
            'https://fireworks.ai/models',
            'https://groq.com/models/',
            'https://www.cerebras.net/inference/',
            'https://modal.com/docs/examples/llm-serving',
            'https://runpod.io/serverless-gpu',
            
            // Emerging & Niche
            'https://www.deepinfra.com/models',
            'https://anyscale.com/endpoints',
            'https://docs.baseten.co/models/overview',
            'https://www.lepton.ai/playground',
            'https://docs.novita.ai/llm/overview',
            'https://fal.ai/models',
            'https://www.banana.dev/models'
        ],
        ai_pricing: [
            // Major Providers
            'https://openai.com/pricing',
            'https://www.anthropic.com/pricing',
            'https://ai.google.dev/pricing',
            'https://cohere.com/pricing',
            'https://mistral.ai/technology/#pricing',
            
            // Cloud Providers
            'https://aws.amazon.com/bedrock/pricing/',
            'https://azure.microsoft.com/en-us/pricing/details/cognitive-services/openai-service/',
            'https://cloud.google.com/vertex-ai/pricing',
            
            // Specialized Providers
            'https://replicate.com/pricing',
            'https://www.together.ai/pricing',
            'https://docs.perplexity.ai/docs/pricing',
            'https://fireworks.ai/pricing',
            'https://groq.com/pricing/',
            'https://www.cerebras.net/pricing/',
            'https://modal.com/pricing',
            'https://www.runpod.io/pricing',
            
            // Emerging & Niche
            'https://deepinfra.com/pricing',
            'https://www.anyscale.com/pricing',
            'https://baseten.co/pricing',
            'https://www.lepton.ai/pricing',
            'https://novita.ai/pricing',
            'https://fal.ai/pricing',
            'https://www.banana.dev/pricing',
            
            // Additional Services
            'https://www.vllm.ai/pricing',
            'https://www.llamaindex.ai/pricing',
            'https://www.langchain.com/pricing',
            'https://www.pinecone.io/pricing/',
            'https://weaviate.io/pricing',
            'https://www.qdrant.tech/pricing/',
            'https://milvus.io/pricing'
        ],
        ai_news: [
            // Major Tech News
            'https://www.artificialintelligence-news.com/',
            'https://venturebeat.com/ai/',
            'https://techcrunch.com/category/artificial-intelligence/',
            'https://www.theverge.com/ai-artificial-intelligence',
            'https://arstechnica.com/tag/artificial-intelligence/',
            'https://www.wired.com/tag/artificial-intelligence/',
            'https://www.technologyreview.com/topic/artificial-intelligence/',
            
            // Academic & Research
            'https://arxiv.org/list/cs.AI/recent',
            'https://arxiv.org/list/cs.LG/recent',
            'https://arxiv.org/list/cs.CL/recent',
            'https://distill.pub/',
            'https://openai.com/blog',
            'https://www.anthropic.com/news',
            'https://ai.googleblog.com/',
            'https://blog.research.google/search/label/Machine%20Learning',
            'https://www.microsoft.com/en-us/research/blog/category/artificial-intelligence/',
            
            // Community & Discussion
            'https://news.ycombinator.com/',
            'https://www.reddit.com/r/MachineLearning/',
            'https://www.reddit.com/r/artificial/',
            'https://www.reddit.com/r/LocalLLaMA/',
            'https://www.reddit.com/r/OpenAI/',
            'https://www.reddit.com/r/ChatGPT/',
            
            // Industry & Business
            'https://www.aitrends.com/',
            'https://www.unite.ai/news/',
            'https://syncedreview.com/',
            'https://towardsdatascience.com/',
            'https://machinelearningmastery.com/blog/',
            'https://www.kdnuggets.com/',
            
            // Specialized Publications
            'https://huggingface.co/blog',
            'https://blog.langchain.dev/',
            'https://www.pinecone.io/blog/',
            'https://weaviate.io/blog',
            'https://qdrant.tech/blog/',
            'https://blog.llamaindex.ai/',
            
            // Emerging & Startups
            'https://www.producthunt.com/topics/artificial-intelligence',
            'https://www.crunchbase.com/hub/artificial-intelligence-companies',
            'https://pitchbook.com/news/articles/ai-startup-funding',
            'https://www.cbinsights.com/research/artificial-intelligence/'
        ]
    };

    constructor() {
        this.classifier = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0", // Use Nova Pro since Haiku isn't available
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.1, // Low temperature for consistent classification
            maxTokens: 1000,
        });
    }

    async analyzeQuery(query: string): Promise<TrendingQuery> {
        try {
            // Check if this is a Cost Katana query first - these should NOT be treated as trending/shopping
            if (this.isCostKatanaQuery(query)) {
                loggingService.info(`🎯 Detected Cost Katana query, skipping trending analysis: "${query}"`);
                return {
                    needsRealTimeData: false,
                    confidence: 0.0,
                    suggestedSources: [],
                    queryType: 'general',
                    extractionStrategy: { selectors: {} },
                    cacheStrategy: { ttl: 3600, refreshTriggers: ['manual'] }
                };
            }
            
            // Quick pattern-based detection
            const patternScore = this.calculatePatternScore(query);
            
            // AI-powered classification for complex queries
            const aiClassification = await this.classifyWithAI(query);
            
            // Combine scores - be more aggressive for general queries
            const confidence = Math.max(patternScore, aiClassification.confidence);
            const needsRealTimeData = confidence > 0.3; // Lower threshold to catch more queries

            // Determine query type and sources
            const queryType = this.determineQueryType(query, aiClassification);
            const suggestedSources = this.getSuggestedSources(queryType, query);
            
            // Create extraction strategy
            const extractionStrategy = this.createExtractionStrategy(queryType, query);
            
            // Determine cache strategy
            const cacheStrategy = this.createCacheStrategy(queryType);

            const result: TrendingQuery = {
                needsRealTimeData,
                confidence,
                suggestedSources,
                queryType,
                extractionStrategy,
                cacheStrategy
            };

            loggingService.info(`🔍 Trending analysis for "${query}":`, {
                needsRealTimeData,
                confidence: confidence.toFixed(2),
                queryType,
                sourcesCount: suggestedSources.length
            });

            return result;

        } catch (error) {
            loggingService.error('Trending detection failed:', { error: error instanceof Error ? error.message : String(error) });
            
            // Fallback to safe defaults
            return {
                needsRealTimeData: false,
                confidence: 0,
                suggestedSources: [],
                queryType: 'general',
                extractionStrategy: {
                    selectors: {
                        title: 'h1, .title, .headline',
                        content: '.content, article, .post'
                    }
                },
                cacheStrategy: {
                    ttl: 3600,
                    refreshTriggers: []
                }
            };
        }
    }

    /**
     * Check if query is about Cost Katana (AI cost optimization platform)
     */
    private isCostKatanaQuery(query: string): boolean {
        const costKatanaPatterns = [
            /cost\s*katana/i,
            /costkatana/i,
            /what\s+is\s+cost\s*katana/i,
            /what\s+is\s+costkatana/i,
            /tell\s+me\s+about\s+cost\s*katana/i,
            /explain\s+cost\s*katana/i,
            /ai\s+cost\s+optimizer/i,
            /cost\s+optimization\s+platform/i,
            /cost\s+optimization\s+system/i
        ];
        
        return costKatanaPatterns.some(pattern => pattern.test(query));
    }

    private calculatePatternScore(query: string): number {
        let score = 0;
        let matches = 0;

        for (const pattern of this.realTimePatterns) {
            if (pattern.test(query)) {
                matches++;
                // Weight different patterns differently
                if (pattern.source.includes('trending|popular')) score += 0.4;
                else if (pattern.source.includes('price|cost')) score += 0.3;
                else if (pattern.source.includes('today|now|current')) score += 0.5;
                else score += 0.2;
            }
        }

        // Normalize score
        return Math.min(score, 1.0);
    }

    private async classifyWithAI(query: string): Promise<{ confidence: number; reasoning: string }> {
        const startTime = Date.now();
        const prompt = `Analyze this query and determine if it needs real-time web data.

Query: "${query}"

Consider:
1. Does it ask for trending/popular content?
2. Does it need current prices or deals?
3. Does it reference specific websites/platforms?
4. Does it ask for recent news or updates?
5. Does it need live/current information?

Respond with JSON:
{
    "confidence": 0.0-1.0,
    "reasoning": "brief explanation"
}`;

        const estimatedInputTokens = Math.ceil(prompt.length / 4);

        try {
            const response = await this.classifier.invoke([
                { role: 'user', content: prompt }
            ]);

            const latency = Date.now() - startTime;
            const responseText = response.content.toString();
            const estimatedOutputTokens = Math.ceil(responseText.length / 4);

            // Track AI cost for monitoring
            AICostTrackingService.trackCall({
                service: 'trending_detection',
                operation: 'classify_query',
                model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                inputTokens: estimatedInputTokens,
                outputTokens: estimatedOutputTokens,
                estimatedCost: (estimatedInputTokens * 0.0000008 + estimatedOutputTokens * 0.000004), // Claude Haiku pricing
                latency,
                success: true,
                metadata: {
                    queryLength: query.length
                }
            });

            try {
                const parsed = JSON.parse(responseText);
                return {
                    confidence: parsed.confidence || 0,
                    reasoning: parsed.reasoning || 'No reasoning provided'
                };
            } catch {
                // Fallback parsing
                const confidenceMatch = responseText.match(/confidence["\s:]+([0-9.]+)/i);
                const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;
                
                return { confidence, reasoning: responseText };
            }

        } catch (error) {
            // Track failed AI call
            AICostTrackingService.trackCall({
                service: 'trending_detection',
                operation: 'classify_query',
                model: 'anthropic.claude-3-5-haiku-20241022-v1:0',
                inputTokens: estimatedInputTokens,
                outputTokens: 0,
                estimatedCost: 0,
                latency: Date.now() - startTime,
                success: false,
                error: error instanceof Error ? error.message : String(error)
            });

            loggingService.error('AI classification failed:', { error: error instanceof Error ? error.message : String(error) });
            return { confidence: 0, reasoning: 'Classification failed' };
        }
    }

    private determineQueryType(query: string, _aiClassification: any): TrendingQuery['queryType'] {
        const queryLower = query.toLowerCase();
        
        // AI-specific queries (check first for more specific routing)
        if (/ai\s+pricing|model\s+pricing|token\s+cost|openai\s+pricing|anthropic\s+pricing|claude\s+pricing|gpt\s+pricing/.test(queryLower)) return 'ai_pricing';
        if (/ai\s+models?|llm|large\s+language\s+model|available\s+models|model\s+comparison/.test(queryLower)) return 'ai_models';
        if (/ai\s+news|artificial\s+intelligence\s+news|latest\s+ai|ai\s+updates/.test(queryLower)) return 'ai_news';
        
        // Professional/People search queries
        if (/check\s+on\s+linkedin|linkedin\s+profile|who\s+is.*on\s+linkedin|find.*on\s+linkedin/.test(queryLower)) return 'professional';
        if (/twitter\s+profile|check\s+on\s+twitter|who\s+is.*on\s+twitter/.test(queryLower)) return 'social';
        if (/github\s+profile|check\s+on\s+github|who\s+is.*on\s+github/.test(queryLower)) return 'tech';
        
        // Existing patterns
        if (/trending|popular|hot|viral|top\s+\d+/.test(queryLower)) return 'trending';
        if (/price|cost|deal|discount|sale|track\s+price|do\s+you\s+have|available\s+on|buy|purchase|shop|order|microphone|mic|headphones|laptop|phone|camera|under\s+\d+|below\s+\d+|less\s+than\s+\d+|budget\s+of|on\s+amazon|on\s+flipkart/.test(queryLower)) return 'shopping';
        if (/weather|temperature|forecast|climate/.test(queryLower)) return 'weather';
        if (/symptoms|headache|fever|cough|pain|health|medical/.test(queryLower)) return 'health';
        if (/travel|flight|train|bus|book\s+ticket|trip/.test(queryLower)) return 'travel';
        if (/identify|what\s+is\s+this|reverse\s+search/.test(queryLower)) return 'reverse_search';
        if (/news|update|announcement/.test(queryLower)) return 'news';
        if (/reddit|twitter|social|discussion/.test(queryLower)) return 'social';
        if (/github|tool|app|tech|ai|startup/.test(queryLower)) return 'tech';
        
        return 'general';
    }

    private getSuggestedSources(queryType: TrendingQuery['queryType'], query: string): string[] {
        const queryLower = query.toLowerCase();
        let sources: string[] = [];

        switch (queryType) {
            case 'trending':
            case 'tech':
                sources = [...this.sourceMapping.trending_tech];
                break;
            case 'pricing':
            case 'shopping':
                sources = [...this.sourceMapping.pricing];
                // Add specific e-commerce sites based on query
                if (queryLower.includes('flipkart')) {
                    sources.unshift('https://www.flipkart.com/');
                }
                if (queryLower.includes('amazon.com')) {
                    sources.unshift('https://www.amazon.com/');
                } else if (queryLower.includes('amazon')) {
                    sources.unshift('https://www.amazon.in/');
                }
                break;
            case 'weather':
                sources = [...this.sourceMapping.weather];
                // Add specific weather sites based on location
                if (queryLower.includes('bengaluru') || queryLower.includes('bangalore')) {
                    sources.unshift(
                        'https://www.accuweather.com/en/in/bengaluru/202190/weather-forecast/202190',
                        'https://www.weather.gov/wrh/forecast?lat=12.9716&lon=77.5946&name=Bengaluru',
                        'https://www.timeanddate.com/weather/india/bangalore',
                        'https://www.meteoblue.com/en/weather/week/bangalore_india_1277333'
                    );
                }
                break;
            case 'health':
                sources = [
                    'https://www.mohfw.gov.in/',
                    'https://www.mayoclinic.org/',
                    'https://www.webmd.com/',
                    'https://www.healthline.com/'
                ];
                break;
            case 'travel':
                sources = [
                    'https://www.makemytrip.com/',
                    'https://www.irctc.co.in/',
                    'https://www.goibibo.com/',
                    'https://www.cleartrip.com/'
                ];
                break;
            case 'shopping':
                sources = [
                    'https://www.amazon.in/',
                    'https://www.flipkart.com/',
                    'https://www.myntra.com/',
                    'https://www.snapdeal.com/'
                ];
                break;
            case 'reverse_search':
                sources = [
                    'https://www.google.com/search',
                    'https://www.amazon.in/',
                    'https://www.flipkart.com/'
                ];
                break;
            case 'professional':
                sources = [...this.sourceMapping.professional];
                // Add specific LinkedIn search based on query
                if (queryLower.includes('linkedin')) {
                    const nameMatch = queryLower.match(/who\s+is\s+(.+?)(?:\s|$)/);
                    if (nameMatch) {
                        const name = nameMatch[1].trim();
                        sources.unshift(`https://www.linkedin.com/search/results/all/?keywords=${encodeURIComponent(name)}`);
                    }
                }
                break;
            case 'ai_models':
                sources = [...this.sourceMapping.ai_models];
                // Add specific model searches
                if (queryLower.includes('openai') || queryLower.includes('gpt')) {
                    sources.unshift('https://platform.openai.com/docs/models');
                }
                if (queryLower.includes('claude') || queryLower.includes('anthropic')) {
                    sources.unshift('https://docs.anthropic.com/claude/docs/models-overview');
                }
                if (queryLower.includes('gemini') || queryLower.includes('google')) {
                    sources.unshift('https://ai.google.dev/models/gemini');
                }
                if (queryLower.includes('mistral') || queryLower.includes('mixtral')) {
                    sources.unshift('https://docs.mistral.ai/platform/endpoints/');
                }
                if (queryLower.includes('cohere') || queryLower.includes('command')) {
                    sources.unshift('https://docs.cohere.com/docs/models');
                }
                if (queryLower.includes('huggingface') || queryLower.includes('hugging face')) {
                    sources.unshift('https://huggingface.co/models');
                }
                if (queryLower.includes('replicate')) {
                    sources.unshift('https://replicate.com/explore');
                }
                if (queryLower.includes('together')) {
                    sources.unshift('https://www.together.ai/models');
                }
                if (queryLower.includes('groq')) {
                    sources.unshift('https://groq.com/models/');
                }
                if (queryLower.includes('fireworks')) {
                    sources.unshift('https://fireworks.ai/models');
                }
                if (queryLower.includes('perplexity')) {
                    sources.unshift('https://docs.perplexity.ai/docs/model-cards');
                }
                if (queryLower.includes('ollama')) {
                    sources.unshift('https://ollama.ai/library');
                }
                break;
            case 'ai_pricing':
                sources = [...this.sourceMapping.ai_pricing];
                // Add specific pricing pages
                if (queryLower.includes('openai') || queryLower.includes('gpt')) {
                    sources.unshift('https://openai.com/pricing');
                }
                if (queryLower.includes('claude') || queryLower.includes('anthropic')) {
                    sources.unshift('https://www.anthropic.com/pricing');
                }
                if (queryLower.includes('bedrock') || queryLower.includes('aws')) {
                    sources.unshift('https://aws.amazon.com/bedrock/pricing/');
                }
                if (queryLower.includes('mistral')) {
                    sources.unshift('https://mistral.ai/technology/#pricing');
                }
                if (queryLower.includes('cohere')) {
                    sources.unshift('https://cohere.com/pricing');
                }
                if (queryLower.includes('replicate')) {
                    sources.unshift('https://replicate.com/pricing');
                }
                if (queryLower.includes('together')) {
                    sources.unshift('https://www.together.ai/pricing');
                }
                if (queryLower.includes('groq')) {
                    sources.unshift('https://groq.com/pricing/');
                }
                if (queryLower.includes('fireworks')) {
                    sources.unshift('https://fireworks.ai/pricing');
                }
                if (queryLower.includes('perplexity')) {
                    sources.unshift('https://docs.perplexity.ai/docs/pricing');
                }
                if (queryLower.includes('deepinfra')) {
                    sources.unshift('https://deepinfra.com/pricing');
                }
                if (queryLower.includes('anyscale')) {
                    sources.unshift('https://www.anyscale.com/pricing');
                }
                if (queryLower.includes('modal')) {
                    sources.unshift('https://modal.com/pricing');
                }
                if (queryLower.includes('runpod')) {
                    sources.unshift('https://www.runpod.io/pricing');
                }
                break;
            case 'ai_news':
                sources = [...this.sourceMapping.ai_news];
                // Add specific AI news sources based on query
                if (queryLower.includes('openai') || queryLower.includes('chatgpt')) {
                    sources.unshift('https://techcrunch.com/tag/openai/');
                }
                if (queryLower.includes('google') || queryLower.includes('gemini')) {
                    sources.unshift('https://blog.google/technology/ai/');
                }
                break;
            case 'news':
                sources = [...this.sourceMapping.news];
                break;
            case 'social':
                sources = [...this.sourceMapping.social];
                if (queryLower.includes('hacker news')) {
                    sources = ['https://news.ycombinator.com/'];
                }
                if (queryLower.includes('reddit')) {
                    sources = ['https://www.reddit.com/'];
                }
                break;
            default:
                // For general queries, use search engines and knowledge sources
                sources = [
                    ...this.sourceMapping.general
                ];
                // Add specific sources based on query content
                if (queryLower.includes('weather') || queryLower.includes('temperature')) {
                    sources.unshift(...this.sourceMapping.weather.slice(0, 2));
                }
                if (queryLower.includes('price') || queryLower.includes('cost')) {
                    sources.unshift(...this.sourceMapping.pricing.slice(0, 2));
                }
                if (queryLower.includes('news') || queryLower.includes('trending')) {
                    sources.unshift(...this.sourceMapping.trending_tech.slice(0, 2));
                }
        }

        return sources;
    }

    private createExtractionStrategy(queryType: TrendingQuery['queryType'], _query: string): TrendingQuery['extractionStrategy'] {
        const baseSelectors = {
            title: 'h1, .title, .headline, .post-title',
            content: '.content, article, .post, .story-text'
        };

        switch (queryType) {
            case 'trending':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.titleline > a, .story-title, .title',
                        content: '.subtext, .story-text, .excerpt',
                        links: '.titleline > a, .story-link'
                    },
                    javascript: false
                };

            case 'pricing':
            case 'shopping':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.product-title, .item-title, h1, [data-cy="title"], .s-title-instructions-style h2',
                        prices: '.price, .cost, .amount, .price-current, .a-price-whole, .a-price, ._30jeq3',
                        images: '.product-image img, .item-image img, .s-image',
                        content: '.product-description, .item-description, .feature-bullets, .aplus-v2'
                    },
                    waitFor: '.price, .product-title, .s-result-item',
                    javascript: true
                };

            case 'weather':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.current-weather-card h1, .weather-title, .location-name',
                        content: '.current-weather-details, .weather-info, .temperature',
                        temperature: '.current-weather-card .temp, .temperature-value, .temp-display'
                    },
                    javascript: true
                };

            case 'social':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.post-title, .submission-title, .link-title',
                        content: '.usertext-body, .comment, .post-content',
                        links: '.comments, .discussion-link'
                    },
                    javascript: true
                };

            case 'professional':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.pv-text-details__left-panel h1, .profile-name, .top-card-layout__title',
                        content: '.pv-about-section, .profile-summary, .pv-top-card-v2-ctas, .top-card-layout__headline',
                        links: '.profile-link, .pv-contact-info, .contact-info',
                        company: '.pv-entity__secondary-title, .profile-position, .top-card-layout__headline',
                        location: '.pv-top-card--list-bullet, .profile-location, .top-card-layout__first-subline'
                    },
                    waitFor: '.profile-name, .top-card-layout__title, .pv-text-details__left-panel',
                    javascript: true
                };

            case 'ai_models':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: 'h1, h2, h3, .model-name, .api-name',
                        content: '.model-description, .model-details, .api-description, p, div[class*="content"]',
                        links: 'a[href*="model"], a[href*="api"], a[href*="docs"]',
                        pricing: '.pricing, .cost, .price, [class*="price"]',
                        specs: '.specifications, .model-specs, .parameters'
                    },
                    waitFor: 'h1, .model-name, .content',
                    javascript: true
                };

            case 'ai_pricing':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: 'h1, h2, .pricing-title, .plan-name',
                        content: '.pricing-details, .plan-description, .pricing-info, p',
                        pricing: '.price, .cost, .pricing-amount, [class*="price"], [class*="cost"]',
                        features: '.features, .plan-features, .included, ul li',
                        models: '.model-pricing, .api-pricing, [data-model]'
                    },
                    waitFor: '.pricing, .price, h1',
                    javascript: true
                };

            case 'ai_news':
                return {
                    selectors: {
                        ...baseSelectors,
                        title: 'h1, h2, h3, .article-title, .post-title',
                        content: '.article-content, .post-content, .news-content, p',
                        links: 'a[href*="article"], a[href*="news"], a[href*="post"]',
                        date: '.date, .published, .timestamp, time',
                        author: '.author, .byline, .writer'
                    },
                    waitFor: '.article-title, .post-title, h1',
                    javascript: true
                };

            default:
                return {
                    selectors: baseSelectors,
                    javascript: false
                };
        }
    }

    private createCacheStrategy(queryType: TrendingQuery['queryType']): TrendingQuery['cacheStrategy'] {
        switch (queryType) {
            case 'trending':
                return {
                    ttl: 1800, // 30 minutes - trending content changes frequently
                    refreshTriggers: ['hourly', 'trending_update']
                };

            case 'pricing':
                return {
                    ttl: 3600, // 1 hour - prices change but not too frequently
                    refreshTriggers: ['price_change', 'daily']
                };

            case 'news':
                return {
                    ttl: 900, // 15 minutes - news is very time-sensitive
                    refreshTriggers: ['news_update', 'breaking']
                };

            case 'weather':
                return {
                    ttl: 1800, // 30 minutes - weather changes but not too frequently
                    refreshTriggers: ['weather_update', 'hourly']
                };

            case 'social':
                return {
                    ttl: 600, // 10 minutes - social content is very dynamic
                    refreshTriggers: ['social_update', 'viral_content']
                };

            default:
                return {
                    ttl: 3600, // 1 hour default
                    refreshTriggers: ['daily']
                };
        }
    }

    /**
     * Check if a query should trigger web scraping based on simple heuristics
     */
    quickCheck(query: string): boolean {
        // First check if this is a Cost Katana query - these should NOT trigger web scraping
        if (this.isCostKatanaQuery(query)) {
            return false;
        }
        
        return this.realTimePatterns.some(pattern => pattern.test(query));
    }

    /**
     * Get pre-configured scraping templates for common sites
     */
    getScrapingTemplate(url: string): Partial<any> | null {
        const domain = new URL(url).hostname.toLowerCase();

        const templates = {
            'news.ycombinator.com': {
                selectors: {
                    title: '.titleline > a, .athing .title a',
                    content: '.subtext, .hnuser',
                    links: '.titleline > a, .athing .title a'
                },
                options: {
                    waitFor: '.athing', // More reliable selector
                    javascript: false
                }
            },
            'github.com': {
                selectors: {
                    title: 'article h2 a, .Box-row h2 a, .repo-list-item h3 a',
                    content: 'article p, .Box-row p, .repo-list-description, .Box-row .f6',
                    links: 'article h2 a, .Box-row h2 a, .repo-list-item h3 a'
                },
                options: {
                    waitFor: 'article, .Box-row',
                    javascript: true
                }
            },
            'reddit.com': {
                selectors: {
                    title: '[data-testid="post-content"] h3',
                    content: '[data-testid="post-content"] div',
                    links: '[data-testid="post-content"] a'
                },
                options: {
                    waitFor: '[data-testid="post-content"]',
                    javascript: true
                }
            },
            'linkedin.com': {
                selectors: {
                    title: 'h1, h2, h3, .text-heading-xlarge, .text-heading-large, .entity-result__title-text a span',
                    content: '.entity-result__summary, .entity-result__primary-subtitle, .entity-result__secondary-subtitle, p, div[class*="text"]',
                    links: 'a[href*="/in/"], a[href*="/company/"], .entity-result__title-text a',
                    profile: '.entity-result__item, .search-result__wrapper'
                },
                options: {
                    waitFor: '.search-results-container, .entity-result__item, body',
                    javascript: true,
                    timeout: 15000
                }
            }
        };

        for (const [templateDomain, template] of Object.entries(templates)) {
            if (domain.includes(templateDomain)) {
                return template;
            }
        }

        return null;
    }
}