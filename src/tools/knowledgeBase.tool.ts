import { Tool } from "@langchain/core/tools";
import { vectorStoreService } from "../services/vectorStore.service";
import { loggingService } from '../services/logging.service';

export class KnowledgeBaseTool extends Tool {
    name = "knowledge_base_search";
    description = `Search the comprehensive AI Cost Optimizer knowledge base for detailed information about:
    
    CORE CAPABILITIES:
    - Cost optimization strategies and techniques (prompt compression, context trimming, model switching)
    - AI insights and analytics (usage patterns, cost trends, predictive analytics)
    - Multi-agent workflows and coordination patterns
    - API integration guides and system architecture
    - User coaching and educational content
    - Security monitoring and threat detection
    - Data analytics and reporting capabilities
    - Predictive analytics and forecasting
    
    SYSTEM INFORMATION:
    - Current system components (controllers, services, infrastructure)
    - Authentication patterns and API endpoints
    - Real-time monitoring and observability features
    - Webhook management and delivery systems
    - Workflow orchestration capabilities
    - Training dataset management
    - Comprehensive logging and business intelligence
    - Financial governance and cost management
    - Email configuration and notification systems
    - Proactive intelligence and automation
    
    BEST PRACTICES:
    - Implementation guidelines and recommendations
    - Troubleshooting guides and common issues
    - Performance optimization strategies
    - Quality assurance processes
    - Security best practices and monitoring
    - Cost optimization techniques and strategies
    
    Input should be a specific question or search query about any aspect of the AI Cost Optimizer platform.`;

    async _call(query: string): Promise<string> {
        const startTime = Date.now();
        
        try {
            // Extract the core query from contextual information
            const { coreQuery, hasContext, contextInfo } = this.extractCoreQuery(query);
            
            // Special handling for CostKatana queries to ensure accuracy
            if (this.isCostKatanaQuery(coreQuery)) {
                return this.handleCostKatanaQuery(coreQuery);
            }
            
            loggingService.info('Knowledge base search initiated', {
                component: 'knowledgeBaseTool',
                originalQuery: query,
                coreQuery: coreQuery,
                hasContext: hasContext,
                contextInfo: contextInfo,
                timestamp: new Date().toISOString()
            });

            // Search the vector store with the core query for better results
            const results = await vectorStoreService.search(coreQuery, 7);
            
            if (results.length === 0) {
                loggingService.warn('No knowledge base results found', {
                    component: 'knowledgeBaseTool',
                    query: query
                });
                return `No relevant information found in the AI Cost Optimizer knowledge base for: "${query}"

Suggestions:
- Try rephrasing your question
- Use more specific terms related to cost optimization, analytics, or system features
- Ask about specific components like workflows, webhooks, or user management`;
            }

            // Categorize and format results
            const categorizedResults = this.categorizeResults(results);
            let response = `🔍 **Knowledge Base Search Results for: "${coreQuery}"**\n`;
            
            // Add context information if available
            if (hasContext) {
                response += `📋 **Context Considered:**\n`;
                if (contextInfo.conversationContext) {
                    response += `- Previous conversation context included\n`;
                }
                if (contextInfo.modelContext) {
                    response += `- Current model: ${contextInfo.modelContext}\n`;
                }
                if (contextInfo.conversationId) {
                    response += `- Conversation ID: ${contextInfo.conversationId}\n`;
                }
                if (contextInfo.projectId) {
                    response += `- Project context: ${contextInfo.projectId}\n`;
                }
                response += '\n';
            }
            
            response += `Found ${results.length} relevant sources:\n\n`;
            
            // Group by category for better organization
            const categories = Object.keys(categorizedResults);
            
            categories.forEach(category => {
                const categoryResults = categorizedResults[category];
                if (categoryResults.length > 0) {
                    response += `📚 **${category.toUpperCase()}**\n`;
                    
                    categoryResults.forEach((doc, index) => {
                        const source = this.extractSourceName(doc.metadata.source);
                        const relevanceScore = doc.metadata.score ? ` (${Math.round(doc.metadata.score * 100)}% relevant)` : '';
                        
                        response += `\n${index + 1}. **${source}**${relevanceScore}\n`;
                        response += `${this.formatContent(doc.pageContent)}\n`;
                    });
                    response += '\n';
                }
            });

            // Add contextual recommendations
            response += this.generateRecommendations(query, results);

            const duration = Date.now() - startTime;
            
            loggingService.info('Knowledge base search completed', {
                component: 'knowledgeBaseTool',
                query: query,
                resultsCount: results.length,
                categoriesFound: categories.length,
                duration: duration
            });

            // Log business event
            loggingService.logBusiness({
                event: 'knowledge_base_tool_search',
                category: 'agent_knowledge_retrieval',
                value: duration,
                metadata: {
                    query: query,
                    resultsCount: results.length,
                    categoriesFound: categories.length
                }
            });

            return response;
            
        } catch (error) {
            const duration = Date.now() - startTime;
            
            loggingService.error('Knowledge base search failed', {
                component: 'knowledgeBaseTool',
                operation: '_call',
                query: query,
                error: error instanceof Error ? error.message : String(error),
                errorStack: error instanceof Error ? error.stack : undefined,
                duration: duration
            });
            
            return `❌ Error searching AI Cost Optimizer knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}

Please try:
- Simplifying your search query
- Using different keywords
- Asking about specific system components or features`;
        }
    }

    /**
     * Categorize search results by knowledge base section
     */
    private categorizeResults(results: any[]): { [category: string]: any[] } {
        const categories: { [category: string]: any[] } = {
            'Cost Optimization': [],
            'AI Insights & Analytics': [],
            'Multi-Agent Workflows': [],
            'API Integration': [],
            'System Architecture': [],
            'Security & Monitoring': [],
            'User Management': [],
            'Observability & Monitoring': [],
            'Webhooks & Integrations': [],
            'Financial Governance': [],
            'General Documentation': []
        };

        results.forEach(result => {
            const source = result.metadata.source || '';
            
            if (source.includes('cost-optimization')) {
                categories['Cost Optimization'].push(result);
            } else if (source.includes('ai-insights') || source.includes('analytics')) {
                categories['AI Insights & Analytics'].push(result);
            } else if (source.includes('multi-agent') || source.includes('workflow')) {
                categories['Multi-Agent Workflows'].push(result);
            } else if (source.includes('api-integration') || source.includes('API') || source.includes('INTEGRATION_GUIDE')) {
                categories['API Integration'].push(result);
            } else if (source.includes('security') || source.includes('monitoring')) {
                categories['Security & Monitoring'].push(result);
            } else if (source.includes('user') || source.includes('coaching')) {
                categories['User Management'].push(result);
            } else if (source.includes('OBSERVABILITY') || source.includes('observability')) {
                categories['Observability & Monitoring'].push(result);
            } else if (source.includes('WEBHOOK') || source.includes('webhook')) {
                categories['Webhooks & Integrations'].push(result);
            } else if (source.includes('FINANCIAL_GOVERNANCE') || source.includes('financial')) {
                categories['Financial Governance'].push(result);
            } else if (source.includes('knowledge-base') || source.includes('README') || source.includes('PROACTIVE_INTELLIGENCE') || source.includes('EMAIL_CONFIGURATION')) {
                categories['System Architecture'].push(result);
            } else {
                categories['General Documentation'].push(result);
            }
        });

        // Remove empty categories
        Object.keys(categories).forEach(key => {
            if (categories[key].length === 0) {
                delete categories[key];
            }
        });

        return categories;
    }

    /**
     * Extract clean source name from file path
     */
    private extractSourceName(source: string): string {
        if (!source) return 'Unknown Source';
        
        const fileName = source.split('/').pop() || source;
        return fileName.replace('.md', '').replace(/[-_]/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    }

    /**
     * Format content for better readability
     */
    private formatContent(content: string): string {
        // Clean up the content
        let formatted = content.trim();
        
        // Remove excessive newlines
        formatted = formatted.replace(/\n{3,}/g, '\n\n');
        
        // Limit length for readability
        if (formatted.length > 400) {
            formatted = formatted.substring(0, 400) + '...';
        }
        
        return formatted;
    }

    /**
     * Generate contextual recommendations based on query and results
     */
    private generateRecommendations(query: string, results: any[]): string {
        const recommendations: string[] = [];
        
        // Analyze query for specific recommendations
        const queryLower = query.toLowerCase();
        
        if (queryLower.includes('cost') || queryLower.includes('optimization')) {
            recommendations.push('💡 Consider reviewing cost optimization strategies and current usage patterns');
        }
        
        if (queryLower.includes('api') || queryLower.includes('integration')) {
            recommendations.push('🔗 Check API documentation for latest endpoint specifications and authentication methods');
        }
        
        if (queryLower.includes('workflow') || queryLower.includes('agent')) {
            recommendations.push('🤖 Explore multi-agent coordination patterns and workflow orchestration capabilities');
        }
        
        if (queryLower.includes('security') || queryLower.includes('monitoring')) {
            recommendations.push('🔒 Review security monitoring features and threat detection capabilities');
        }
        
        if (queryLower.includes('analytics') || queryLower.includes('insights')) {
            recommendations.push('📊 Explore AI insights and predictive analytics features for better decision making');
        }

        if (queryLower.includes('observability') || queryLower.includes('monitoring') || queryLower.includes('logging')) {
            recommendations.push('📈 Check observability and monitoring documentation for comprehensive system visibility');
        }

        if (queryLower.includes('webhook') || queryLower.includes('integration') || queryLower.includes('delivery')) {
            recommendations.push('🔗 Review webhook documentation for integration patterns and delivery systems');
        }

        if (queryLower.includes('financial') || queryLower.includes('governance') || queryLower.includes('cost management')) {
            recommendations.push('💰 Explore financial governance and cost management strategies for better resource allocation');
        }

        if (queryLower.includes('email') || queryLower.includes('notification') || queryLower.includes('communication')) {
            recommendations.push('📧 Check email configuration and notification system documentation');
        }

        if (queryLower.includes('proactive') || queryLower.includes('intelligence') || queryLower.includes('automation')) {
            recommendations.push('🚀 Explore proactive intelligence and automation capabilities for enhanced system efficiency');
        }

        if (recommendations.length > 0) {
            return `\n**💡 Recommendations:**\n${recommendations.map(rec => `- ${rec}`).join('\n')}\n`;
        }
        
        return '\n**💡 Tip:** Use specific terms related to your area of interest for more targeted results.\n';
    }

    /**
     * Extract the core query from contextual information
     */
    private extractCoreQuery(query: string): {
        coreQuery: string;
        hasContext: boolean;
        contextInfo: {
            conversationContext?: string;
            modelContext?: string;
            conversationId?: string;
            projectId?: string;
        };
    } {
        const contextInfo: any = {};
        let coreQuery = query;
        let hasContext = false;

        // Check if the query contains conversation context
        if (query.includes('Context from conversation:') || query.includes('Conversation context:')) {
            hasContext = true;
            
            // Extract conversation context
            const contextMatch = query.match(/(Context from conversation:|Conversation context:)\s*(.*?)\s*(?:Current query:|$)/s);
            if (contextMatch) {
                contextInfo.conversationContext = contextMatch[2].trim();
            }

            // Extract the actual query
            const queryMatch = query.match(/(?:Current query:|Query:)\s*(.*?)(?:\n|$)/s);
            if (queryMatch) {
                coreQuery = queryMatch[1].trim();
            }
        }

        // Extract model context
        if (query.includes('User is currently using model:')) {
            hasContext = true;
            const modelMatch = query.match(/User is currently using model:\s*([^\n]+)/);
            if (modelMatch) {
                contextInfo.modelContext = modelMatch[1].trim();
            }
        }

        // Extract conversation ID
        if (query.includes('Conversation ID:') || query.includes('Conversation:')) {
            hasContext = true;
            const conversationMatch = query.match(/Conversation(?:\s+ID)?:\s*([^\n]+)/);
            if (conversationMatch) {
                contextInfo.conversationId = conversationMatch[1].trim();
            }
        }

        // Extract project context
        if (query.includes('Project context:')) {
            hasContext = true;
            const projectMatch = query.match(/Project context:\s*([^\n]+)/);
            if (projectMatch) {
                contextInfo.projectId = projectMatch[1].trim();
            }
        }

        // If no specific query was extracted, use the original but clean it up
        if (coreQuery === query && hasContext) {
            // Remove context markers and clean up
            coreQuery = query
                .replace(/(?:Context from conversation:|Conversation context:).*?(?=Current query:|Query:|$)/s, '')
                .replace(/(?:Current query:|Query:)\s*/g, '')
                .replace(/User is currently using model:.*$/gm, '')
                .replace(/Conversation(?:\s+ID)?:.*$/gm, '')
                .replace(/Project context:.*$/gm, '')
                .trim();
        }

        // Fallback: if core query is empty, use original
        if (!coreQuery || coreQuery.length < 3) {
            coreQuery = query;
        }

        return {
            coreQuery,
            hasContext,
            contextInfo
        };
    }

    /**
     * Check if the query is a CostKatana-specific query.
     */
    private isCostKatanaQuery(query: string): boolean {
        const lowerCaseQuery = query.toLowerCase();
        return lowerCaseQuery.includes('costkatana') || lowerCaseQuery.includes('cost kata');
    }

    /**
     * Handle CostKatana-specific queries to provide more accurate responses.
     */
    private handleCostKatanaQuery(query: string): string {
        return `💡 **CostKatana Specific Query:**\n\n` +
               `I understand you're asking about CostKatana. This tool is primarily focused on the AI Cost Optimizer platform. ` +
               `For specific CostKatana-related questions, please refer to the dedicated CostKatana documentation or support channels. ` +
               `The AI Cost Optimizer platform itself provides a comprehensive set of tools and features for cost optimization, ` +
               `including model switching, context trimming, and usage analytics.`;
    }
}