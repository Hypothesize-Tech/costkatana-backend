import { logger } from '../utils/logger';
import { ChatBedrockConverse } from "@langchain/aws";

export interface TrendingQuery {
    needsRealTimeData: boolean;
    confidence: number;
    suggestedSources: string[];
    queryType: 'trending' | 'pricing' | 'news' | 'social' | 'tech' | 'weather' | 'health' | 'travel' | 'shopping' | 'reverse_search' | 'general';
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

            logger.info(`🔍 Trending analysis for "${query}":`, {
                needsRealTimeData,
                confidence: confidence.toFixed(2),
                queryType,
                sourcesCount: suggestedSources.length
            });

            return result;

        } catch (error) {
            logger.error('Trending detection failed:', error);
            
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
        try {
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

            const response = await this.classifier.invoke([
                { role: 'user', content: prompt }
            ]);

            try {
                const parsed = JSON.parse(response.content.toString());
                return {
                    confidence: parsed.confidence || 0,
                    reasoning: parsed.reasoning || 'No reasoning provided'
                };
            } catch {
                // Fallback parsing
                const content = response.content.toString();
                const confidenceMatch = content.match(/confidence["\s:]+([0-9.]+)/i);
                const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0;
                
                return { confidence, reasoning: content };
            }

        } catch (error) {
            logger.error('AI classification failed:', error);
            return { confidence: 0, reasoning: 'Classification failed' };
        }
    }

    private determineQueryType(query: string, _aiClassification: any): TrendingQuery['queryType'] {
        const queryLower = query.toLowerCase();
        
        if (/trending|popular|hot|viral|top\s+\d+/.test(queryLower)) return 'trending';
        if (/price|cost|deal|discount|sale|track\s+price/.test(queryLower)) return 'shopping';
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
                sources = [...this.sourceMapping.pricing];
                // Add specific e-commerce sites based on query
                if (queryLower.includes('flipkart')) {
                    sources.unshift('https://www.flipkart.com/');
                }
                if (queryLower.includes('amazon')) {
                    sources.unshift('https://www.amazon.com/');
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
                return {
                    selectors: {
                        ...baseSelectors,
                        title: '.product-title, .item-title, h1',
                        prices: '.price, .cost, .amount, .price-current',
                        images: '.product-image img, .item-image img'
                    },
                    waitFor: '.price, .product-title',
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