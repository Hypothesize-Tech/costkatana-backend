import { ChatBedrockConverse } from "@langchain/aws";
import { HumanMessage } from "@langchain/core/messages";
import { loggingService } from './logging.service';

export interface SmartTag {
    tag: string;
    confidence: number;
    platform: string;
    searchStrategy: 'profile' | 'content' | 'product' | 'location' | 'general';
    extractedEntities: {
        person?: string;
        company?: string;
        location?: string;
        product?: string;
        skill?: string;
        topic?: string;
    };
}

export interface TagGenerationResult {
    primaryTags: SmartTag[];
    secondaryTags: SmartTag[];
    recommendedPlatforms: string[];
    searchQuery: string;
    navigationStrategy: {
        platform: string;
        url: string;
        selectors: Record<string, string>;
        actions?: string[];
    }[];
}

export class SmartTagGeneratorService {
    private tagGenerator: ChatBedrockConverse;
    
    // Platform-specific patterns and strategies
    private readonly platformStrategies = {
        linkedin: {
            patterns: [/linkedin|professional|career|work|job|company|ceo|founder|executive/i],
            baseUrl: 'https://www.linkedin.com',
            searchPath: '/search/results/all/?keywords=',
            selectors: {
                profile: 'h1, h2, h3, .text-heading-xlarge, .entity-result__title-text a span, .search-result__info h3',
                company: '.entity-result__primary-subtitle, .entity-result__secondary-subtitle, .search-result__info .subline-level-1',
                location: '.entity-result__secondary-subtitle, .search-result__info .subline-level-2',
                about: '.entity-result__summary, p, div[class*="text"]'
            }
        },
        twitter: {
            patterns: [/twitter|tweet|social|follow|trending|hashtag/i],
            baseUrl: 'https://twitter.com',
            searchPath: '/search?q=',
            selectors: {
                profile: '[data-testid="UserName"]',
                bio: '[data-testid="UserDescription"]',
                tweets: '[data-testid="tweet"]',
                followers: '[data-testid="UserFollowersContainer"]'
            }
        },
        github: {
            patterns: [/github|code|repository|developer|programming|open\s+source/i],
            baseUrl: 'https://github.com',
            searchPath: '/search?q=',
            selectors: {
                profile: '.vcard-fullname, .p-name',
                bio: '.user-profile-bio',
                repositories: '.repo-list-item',
                contributions: '.js-yearly-contributions'
            }
        },
        amazon: {
            patterns: [/amazon|buy|purchase|product|price|shopping/i],
            baseUrl: 'https://www.amazon.com',
            searchPath: '/s?k=',
            selectors: {
                title: '[data-cy="title"], .s-title-instructions-style h2',
                price: '.a-price-whole, .a-price, ._30jeq3',
                rating: '.a-icon-alt, .review-rating',
                availability: '.a-size-medium.a-color-success'
            }
        },
        google: {
            patterns: [/search|find|what\s+is|how\s+to|general/i],
            baseUrl: 'https://www.google.com',
            searchPath: '/search?q=',
            selectors: {
                title: 'h3',
                snippet: '.VwiC3b, .s3v9rd',
                link: '.yuRUbf a',
                knowledge_panel: '.kp-wholepage'
            }
        },
        openai: {
            patterns: [/openai|gpt|chatgpt|openai\s+pricing|gpt\s+models/i],
            baseUrl: 'https://platform.openai.com',
            searchPath: '/docs/models',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        anthropic: {
            patterns: [/anthropic|claude|claude\s+pricing|claude\s+models/i],
            baseUrl: 'https://docs.anthropic.com',
            searchPath: '/claude/docs/models-overview',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        huggingface: {
            patterns: [/hugging\s+face|huggingface|hf\s+models|open\s+source\s+models/i],
            baseUrl: 'https://huggingface.co',
            searchPath: '/models?search=',
            selectors: {
                title: 'h1, h2, h3, .model-name, .repo-name',
                content: '.model-description, .repo-description, p',
                links: 'a[href*="/models/"], a[href*="/datasets/"]',
                stats: '.downloads, .likes, .model-stats'
            }
        },
        mistral: {
            patterns: [/mistral|mistral\s+ai|mixtral/i],
            baseUrl: 'https://docs.mistral.ai',
            searchPath: '/platform/endpoints/',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        cohere: {
            patterns: [/cohere|command|embed/i],
            baseUrl: 'https://docs.cohere.com',
            searchPath: '/docs/models',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        replicate: {
            patterns: [/replicate|replicate\s+ai/i],
            baseUrl: 'https://replicate.com',
            searchPath: '/explore?q=',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                stats: '.run-count, .model-stats'
            }
        },
        together: {
            patterns: [/together\s+ai|together\s+computer/i],
            baseUrl: 'https://www.together.ai',
            searchPath: '/models?search=',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        groq: {
            patterns: [/groq|groq\s+ai/i],
            baseUrl: 'https://groq.com',
            searchPath: '/models/',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        fireworks: {
            patterns: [/fireworks\s+ai|fireworks/i],
            baseUrl: 'https://fireworks.ai',
            searchPath: '/models?search=',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        },
        perplexity: {
            patterns: [/perplexity|perplexity\s+ai/i],
            baseUrl: 'https://docs.perplexity.ai',
            searchPath: '/docs/model-cards',
            selectors: {
                title: 'h1, h2, h3, .model-name',
                content: '.model-description, p, div[class*="content"]',
                pricing: '.pricing, .cost, [class*="price"]',
                specs: '.specifications, .parameters'
            }
        }
    };

    constructor() {
        this.tagGenerator = new ChatBedrockConverse({
            model: "amazon.nova-pro-v1:0",
            region: process.env.AWS_REGION || 'us-east-1',
            temperature: 0.2, // Low temperature for consistent tag generation
            maxTokens: 1500,
        });
    }

    async generateSmartTags(query: string): Promise<TagGenerationResult> {
        try {
            loggingService.info(`🏷️ Generating smart tags for query: "${query}"`);
            
            // Extract entities using AI
            const entities = await this.extractEntities(query);
            
            // Generate platform-specific tags
            const primaryTags = this.generatePlatformTags(query, entities);
            const secondaryTags = this.generateContextualTags(query, entities);
            
            // Determine recommended platforms
            const recommendedPlatforms = this.recommendPlatforms(query, primaryTags);
            
            // Create navigation strategies
            const navigationStrategy = this.createNavigationStrategies(query, entities, recommendedPlatforms);
            
            // Generate optimized search query
            const searchQuery = this.optimizeSearchQuery(query, entities);
            
            return {
                primaryTags,
                secondaryTags,
                recommendedPlatforms,
                searchQuery,
                navigationStrategy
            };
            
        } catch (error) {
            loggingService.error('❌ Smart tag generation failed:', { error: error instanceof Error ? error.message : String(error) });
            return this.getFallbackTags(query);
        }
    }

    private async extractEntities(query: string): Promise<SmartTag['extractedEntities']> {
        const entityPrompt = `Extract key entities from this query: "${query}"

CRITICAL: You must respond with ONLY valid JSON, no other text.

Return exactly this JSON structure:
{
  "person": "extracted person name or null",
  "company": "extracted company name or null", 
  "location": "extracted location or null",
  "product": "extracted product or null",
  "skill": "extracted skill/technology or null",
  "topic": "extracted main topic or null"
}

Example for "check on linkedin who is John Smith":
{
  "person": "John Smith",
  "company": null,
  "location": null,
  "product": null,
  "skill": null,
  "topic": "professional profile"
}`;

        try {
            const response = await this.tagGenerator.invoke([new HumanMessage(entityPrompt)]);
            const content = response.content.toString().trim();
            
            // Extract JSON from response if it contains extra text
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const jsonString = jsonMatch ? jsonMatch[0] : content;
            
            const entityData = JSON.parse(jsonString);
            return entityData;
        } catch (error) {
            loggingService.warn('Entity extraction failed, using fallback:', { error: error instanceof Error ? error.message : String(error) });
            return this.extractEntitiesWithRegex(query);
        }
    }

    private extractEntitiesWithRegex(query: string): SmartTag['extractedEntities'] {
        const entities: SmartTag['extractedEntities'] = {};
        
        // Extract person names (improved patterns)
        let personMatch = query.match(/(?:who\s+is\s+|check\s+on\s+.*?\s+who\s+is\s+|find\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i);
        if (!personMatch) {
            // Try alternative pattern for "check on linkedin who is Abdul Sagheer"
            personMatch = query.match(/who\s+is\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)/i);
        }
        if (personMatch) entities.person = personMatch[1].trim();
        
        // Extract company names (common patterns)
        const companyMatch = query.match(/(?:at\s+|from\s+|works?\s+at\s+)([A-Z][a-zA-Z\s&]+(?:Inc|LLC|Corp|Ltd|Company)?)/i);
        if (companyMatch) entities.company = companyMatch[1].trim();
        
        // Extract locations
        const locationMatch = query.match(/(?:in\s+|at\s+|from\s+)([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i);
        if (locationMatch) entities.location = locationMatch[1].trim();
        
        // Extract products
        const productMatch = query.match(/(?:price\s+of\s+|buy\s+|purchase\s+)([a-zA-Z0-9\s]+)/i);
        if (productMatch) entities.product = productMatch[1].trim();
        
        // Set topic based on platform context
        if (query.toLowerCase().includes('linkedin')) {
            entities.topic = 'professional profile';
        } else if (query.toLowerCase().includes('github')) {
            entities.topic = 'developer profile';
        } else if (query.toLowerCase().includes('twitter')) {
            entities.topic = 'social profile';
        }
        
        return entities;
    }

    private generatePlatformTags(query: string, entities: SmartTag['extractedEntities']): SmartTag[] {
        const tags: SmartTag[] = [];
        const queryLower = query.toLowerCase();
        
        for (const [platform, strategy] of Object.entries(this.platformStrategies)) {
            let confidence = 0;
            
            // Check pattern matches
            for (const pattern of strategy.patterns) {
                if (pattern.test(queryLower)) {
                    confidence += 0.3;
                }
            }
            
            // Boost confidence based on entities
            if (platform === 'linkedin' && (entities.person || entities.company)) confidence += 0.4;
            if (platform === 'github' && (entities.person || entities.skill)) confidence += 0.4;
            if (platform === 'amazon' && entities.product) confidence += 0.4;
            
            // Explicit platform mentions
            if (queryLower.includes(platform)) confidence += 0.5;
            
            if (confidence > 0.3) {
                tags.push({
                    tag: platform,
                    confidence: Math.min(confidence, 1.0),
                    platform,
                    searchStrategy: this.determineSearchStrategy(platform, entities),
                    extractedEntities: entities
                });
            }
        }
        
        return tags.sort((a, b) => b.confidence - a.confidence);
    }

    private generateContextualTags(_query: string, entities: SmartTag['extractedEntities']): SmartTag[] {
        const contextualTags: SmartTag[] = [];
        
        // Add entity-based tags
        if (entities.person) {
            contextualTags.push({
                tag: 'person_search',
                confidence: 0.8,
                platform: 'multiple',
                searchStrategy: 'profile',
                extractedEntities: entities
            });
        }
        
        if (entities.product) {
            contextualTags.push({
                tag: 'product_search',
                confidence: 0.7,
                platform: 'ecommerce',
                searchStrategy: 'product',
                extractedEntities: entities
            });
        }
        
        return contextualTags;
    }

    private recommendPlatforms(_query: string, primaryTags: SmartTag[]): string[] {
        const platforms = new Set<string>();
        
        // Add platforms from high-confidence tags
        primaryTags
            .filter(tag => tag.confidence > 0.5)
            .forEach(tag => platforms.add(tag.platform));
        
        // Always include Google as fallback
        platforms.add('google');
        
        return Array.from(platforms);
    }

    private createNavigationStrategies(
        query: string, 
        entities: SmartTag['extractedEntities'], 
        platforms: string[]
    ): TagGenerationResult['navigationStrategy'] {
        const strategies: TagGenerationResult['navigationStrategy'] = [];
        
        for (const platform of platforms) {
            const strategy = this.platformStrategies[platform as keyof typeof this.platformStrategies];
            if (!strategy) continue;
            
            let searchTerm = query;
            if (entities.person) searchTerm = entities.person;
            else if (entities.product) searchTerm = entities.product;
            else if (entities.company) searchTerm = entities.company;
            
            let searchUrl = `${strategy.baseUrl}${strategy.searchPath}${encodeURIComponent(searchTerm)}`;
            
            // For LinkedIn, also add a Google fallback search
            if (platform === 'linkedin' && entities.person) {
                strategies.push({
                    platform: 'google_linkedin',
                    url: `https://www.google.com/search?q=site:linkedin.com/in ${encodeURIComponent(entities.person)}`,
                    selectors: {
                        title: 'h3',
                        content: '.VwiC3b, .s3v9rd',
                        links: '.yuRUbf a[href*="linkedin.com"]'
                    },
                    actions: ['extract_linkedin_profiles_from_google']
                });
            }
            
            strategies.push({
                platform,
                url: searchUrl,
                selectors: strategy.selectors,
                actions: this.generateNavigationActions(platform, entities)
            });
        }
        
        return strategies;
    }

    private generateNavigationActions(platform: string, entities: SmartTag['extractedEntities']): string[] {
        const actions: string[] = [];
        
        switch (platform) {
            case 'linkedin':
                actions.push('wait_for_profiles');
                if (entities.person) actions.push('click_first_profile');
                actions.push('extract_profile_data');
                break;
            case 'amazon':
                actions.push('wait_for_products');
                actions.push('extract_product_listings');
                if (entities.product) actions.push('filter_by_relevance');
                break;
            case 'github':
                actions.push('wait_for_results');
                if (entities.person) actions.push('click_users_tab');
                actions.push('extract_profile_info');
                break;
        }
        
        return actions;
    }

    private determineSearchStrategy(platform: string, entities: SmartTag['extractedEntities']): SmartTag['searchStrategy'] {
        if (entities.person) return 'profile';
        if (entities.product) return 'product';
        if (entities.location) return 'location';
        if (platform === 'linkedin' || platform === 'github') return 'profile';
        if (platform === 'amazon') return 'product';
        return 'general';
    }

    private optimizeSearchQuery(query: string, entities: SmartTag['extractedEntities']): string {
        // Prioritize extracted entities
        if (entities.person) return entities.person;
        if (entities.product) return entities.product;
        if (entities.company) return entities.company;
        
        // Clean up the original query
        return query
            .replace(/^(check\s+on\s+|who\s+is\s+|find\s+me\s+|show\s+me\s+)/i, '')
            .replace(/\s+on\s+(linkedin|twitter|github|amazon)$/i, '')
            .trim();
    }

    private getFallbackTags(query: string): TagGenerationResult {
        return {
            primaryTags: [{
                tag: 'general_search',
                confidence: 0.5,
                platform: 'google',
                searchStrategy: 'general',
                extractedEntities: {}
            }],
            secondaryTags: [],
            recommendedPlatforms: ['google'],
            searchQuery: query,
            navigationStrategy: [{
                platform: 'google',
                url: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
                selectors: {
                    title: 'h3',
                    snippet: '.VwiC3b',
                    link: '.yuRUbf a'
                }
            }]
        };
    }
}