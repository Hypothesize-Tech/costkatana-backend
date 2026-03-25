import { Tool } from '@langchain/core/tools';
import { getVectorStoreService } from '../modules/agent/services/vector-store.service';
import { loggingService } from '../common/services/logging.service';

export class KnowledgeBaseTool extends Tool {
  name = 'knowledge_base_search';
  description = `Search the comprehensive CostKatana knowledge base for detailed information about:
    
    CORE CAPABILITIES:
    - AI usage optimization strategies (not just prompts - complete usage patterns)
    - Cortex meta-language system for advanced optimization
    - Cost optimization techniques (context trimming, model switching, usage efficiency)
    - AI insights and analytics (usage patterns, cost trends, predictive analytics)
    - Multi-agent workflows and coordination patterns
    - API integration guides and system architecture
    - User coaching and educational content
    - Security monitoring and threat detection
    - Data analytics and reporting capabilities
    - Predictive analytics and forecasting
    
    SYSTEM INFORMATION:
    - Current system components (controllers, services, infrastructure)
    - Cortex architecture (Encoder, Core Processor, Decoder)
    - Cortex impact analytics and justification system
    - Authentication patterns and API endpoints
    - Backend API URL: https://api.costkatana.com
    - Real-time monitoring and observability features
    - Webhook management and delivery systems
    - Workflow orchestration capabilities
    - Training dataset management
    - Comprehensive logging and business intelligence
    - Financial governance and cost management
    - Email configuration and notification systems
    - Proactive intelligence and automation

    PACKAGE INFORMATION:
    - NPM Package: cost-katana (https://www.npmjs.com/package/cost-katana) - Core library for AI cost tracking and optimization
    - NPM Package: cost-katana-cli (https://www.npmjs.com/package/cost-katana-cli) - Command-line interface for AI cost optimization
    - PyPI Package: cost-katana (https://pypi.org/project/cost-katana/) - Python SDK with Cortex meta-language optimization
    - Official packages only - no hypothetical or non-existent packages
    - Cross-platform compatibility and deployment options
    
    BEST PRACTICES:
    - Implementation guidelines and recommendations
    - Troubleshooting guides and common issues
    - Performance optimization strategies
    - Quality assurance processes
    - Security best practices and monitoring
    - Cost optimization techniques and strategies
    
    Input should be a specific question or search query about any aspect of the CostKatana.`;

  async _call(query: string): Promise<string> {
    const startTime = Date.now();

    try {
      // Extract the core query from contextual information
      const { coreQuery, hasContext, contextInfo } =
        this.extractCoreQuery(query);

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
        timestamp: new Date().toISOString(),
      });

      // First, check if we should use AI-enhanced RAG approach (only on core query, not contextual query)
      if (this.shouldUseAIRAG(coreQuery)) {
        return await this.generateAIRAGResponse(coreQuery, contextInfo);
      }

      // Build enhanced search query with context information
      let searchQuery = coreQuery;
      if (hasContext && contextInfo.currentSubject) {
        // Boost search with current subject for better relevance
        searchQuery = `${contextInfo.currentSubject} ${coreQuery}`;

        // Add recent entities if available
        if (
          contextInfo.recentEntities &&
          contextInfo.recentEntities.length > 0
        ) {
          searchQuery += ` ${contextInfo.recentEntities.slice(0, 3).join(' ')}`;
        }

        loggingService.info('Enhanced search query with context', {
          originalQuery: coreQuery,
          enhancedQuery: searchQuery,
          currentSubject: contextInfo.currentSubject,
          recentEntities: contextInfo.recentEntities,
        });
      }

      // Search the vector store with the enhanced query
      const results = await getVectorStoreService().search(searchQuery, 7);

      if (results.length === 0) {
        loggingService.warn('No knowledge base results found', {
          component: 'knowledgeBaseTool',
          query: query,
        });
        return `No relevant information found in the CostKatana knowledge base for: "${query}"

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

      categories.forEach((category) => {
        const categoryResults = categorizedResults[category];
        if (categoryResults.length > 0) {
          response += `📚 **${category.toUpperCase()}**\n`;

          categoryResults.forEach((doc, index) => {
            const source = this.extractSourceName(doc.metadata.source);
            const relevanceScore = doc.metadata.score
              ? ` (${Math.round(doc.metadata.score * 100)}% relevant)`
              : '';

            response += `\n${index + 1}. **${source}**${relevanceScore}\n`;
            response += `${this.formatContent(doc.pageContent)}\n`;
          });
          response += '\n';
        }
      });

      // Add contextual recommendations
      response += this.generateRecommendations(query);

      const duration = Date.now() - startTime;

      loggingService.info('Knowledge base search completed', {
        component: 'knowledgeBaseTool',
        query: query,
        resultsCount: results.length,
        categoriesFound: categories.length,
        duration: duration,
      });

      // Log business event
      loggingService.logBusiness({
        event: 'knowledge_base_tool_search',
        category: 'agent_knowledge_retrieval',
        value: duration,
        metadata: {
          query: query,
          resultsCount: results.length,
          categoriesFound: categories.length,
        },
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
        duration: duration,
      });

      return `❌ Error searching CostKatana knowledge base: ${error instanceof Error ? error.message : 'Unknown error'}

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
      'General Documentation': [],
    };

    results.forEach((result) => {
      const source = result.metadata.source || '';

      if (source.includes('cost-optimization')) {
        categories['Cost Optimization'].push(result);
      } else if (
        source.includes('ai-insights') ||
        source.includes('analytics')
      ) {
        categories['AI Insights & Analytics'].push(result);
      } else if (
        source.includes('multi-agent') ||
        source.includes('workflow')
      ) {
        categories['Multi-Agent Workflows'].push(result);
      } else if (
        source.includes('api-integration') ||
        source.includes('API') ||
        source.includes('INTEGRATION_GUIDE')
      ) {
        categories['API Integration'].push(result);
      } else if (source.includes('security') || source.includes('monitoring')) {
        categories['Security & Monitoring'].push(result);
      } else if (source.includes('user') || source.includes('coaching')) {
        categories['User Management'].push(result);
      } else if (
        source.includes('OBSERVABILITY') ||
        source.includes('observability')
      ) {
        categories['Observability & Monitoring'].push(result);
      } else if (source.includes('WEBHOOK') || source.includes('webhook')) {
        categories['Webhooks & Integrations'].push(result);
      } else if (
        source.includes('FINANCIAL_GOVERNANCE') ||
        source.includes('financial')
      ) {
        categories['Financial Governance'].push(result);
      } else if (
        source.includes('knowledge-base') ||
        source.includes('README') ||
        source.includes('PROACTIVE_INTELLIGENCE') ||
        source.includes('EMAIL_CONFIGURATION')
      ) {
        categories['System Architecture'].push(result);
      } else {
        categories['General Documentation'].push(result);
      }
    });

    // Remove empty categories
    Object.keys(categories).forEach((key) => {
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
    return fileName
      .replace('.md', '')
      .replace(/[-_]/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
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
  private generateRecommendations(query: string): string {
    const recommendations: string[] = [];

    // Analyze query for specific recommendations
    const queryLower = query.toLowerCase();

    if (queryLower.includes('cost') || queryLower.includes('optimization')) {
      recommendations.push(
        '💡 Consider reviewing cost optimization strategies and current usage patterns',
      );
    }

    if (queryLower.includes('api') || queryLower.includes('integration')) {
      recommendations.push(
        '🔗 Check API documentation for latest endpoint specifications and authentication methods',
      );
    }

    if (queryLower.includes('workflow') || queryLower.includes('agent')) {
      recommendations.push(
        '🤖 Explore multi-agent coordination patterns and workflow orchestration capabilities',
      );
    }

    if (queryLower.includes('security') || queryLower.includes('monitoring')) {
      recommendations.push(
        '🔒 Review security monitoring features and threat detection capabilities',
      );
    }

    if (queryLower.includes('analytics') || queryLower.includes('insights')) {
      recommendations.push(
        '📊 Explore AI insights and predictive analytics features for better decision making',
      );
    }

    if (
      queryLower.includes('observability') ||
      queryLower.includes('monitoring') ||
      queryLower.includes('logging')
    ) {
      recommendations.push(
        '📈 Check observability and monitoring documentation for comprehensive system visibility',
      );
    }

    if (
      queryLower.includes('webhook') ||
      queryLower.includes('integration') ||
      queryLower.includes('delivery')
    ) {
      recommendations.push(
        '🔗 Review webhook documentation for integration patterns and delivery systems',
      );
    }

    if (
      queryLower.includes('financial') ||
      queryLower.includes('governance') ||
      queryLower.includes('cost management')
    ) {
      recommendations.push(
        '💰 Explore financial governance and cost management strategies for better resource allocation',
      );
    }

    if (
      queryLower.includes('email') ||
      queryLower.includes('notification') ||
      queryLower.includes('communication')
    ) {
      recommendations.push(
        '📧 Check email configuration and notification system documentation',
      );
    }

    if (
      queryLower.includes('proactive') ||
      queryLower.includes('intelligence') ||
      queryLower.includes('automation')
    ) {
      recommendations.push(
        '🚀 Explore proactive intelligence and automation capabilities for enhanced system efficiency',
      );
    }

    if (recommendations.length > 0) {
      return `\n**💡 Recommendations:**\n${recommendations.map((rec) => `- ${rec}`).join('\n')}\n`;
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
      currentSubject?: string;
      currentIntent?: string;
      recentEntities?: string[];
    };
  } {
    const contextInfo: any = {};
    let coreQuery = query;
    let hasContext = false;

    // Check if the query contains the new context preamble format
    if (
      query.includes('Current subject:') ||
      query.includes('Recent conversation:') ||
      query.includes('Intent:')
    ) {
      hasContext = true;

      // Extract current subject
      const subjectMatch = query.match(/Current subject:\s*([^\n]+)/);
      if (subjectMatch) {
        contextInfo.currentSubject = subjectMatch[1].trim();
      }

      // Extract intent
      const intentMatch = query.match(/Intent:\s*([^\n]+)/);
      if (intentMatch) {
        contextInfo.currentIntent = intentMatch[1].trim();
      }

      // Extract recent entities
      const entitiesMatch = query.match(/Recent entities:\s*([^\n]+)/);
      if (entitiesMatch) {
        contextInfo.recentEntities = entitiesMatch[1]
          .trim()
          .split(',')
          .map((e) => e.trim());
      }

      // Extract conversation context
      const conversationMatch = query.match(
        /Recent conversation:\s*(.*?)(?:\n\nUser query:|$)/s,
      );
      if (conversationMatch) {
        contextInfo.conversationContext = conversationMatch[1].trim();
      }

      // Extract the actual query
      const queryMatch = query.match(/(?:User query:|Query:)\s*(.*?)(?:\n|$)/s);
      if (queryMatch) {
        coreQuery = queryMatch[1].trim();
      }
    }
    // Legacy context format support
    else if (
      query.includes('Context from conversation:') ||
      query.includes('Conversation context:')
    ) {
      hasContext = true;

      // Extract conversation context
      const contextMatch = query.match(
        /(Context from conversation:|Conversation context:)\s*(.*?)\s*(?:Current query:|$)/s,
      );
      if (contextMatch) {
        contextInfo.conversationContext = contextMatch[2].trim();
      }

      // Extract the actual query
      const queryMatch = query.match(
        /(?:Current query:|Query:)\s*(.*?)(?:\n|$)/s,
      );
      if (queryMatch) {
        coreQuery = queryMatch[1].trim();
      }
    }

    // Extract model context
    if (query.includes('User is currently using model:')) {
      hasContext = true;
      const modelMatch = query.match(
        /User is currently using model:\s*([^\n]+)/,
      );
      if (modelMatch) {
        contextInfo.modelContext = modelMatch[1].trim();
      }
    }

    // Extract conversation ID
    if (query.includes('Conversation ID:') || query.includes('Conversation:')) {
      hasContext = true;
      const conversationMatch = query.match(
        /Conversation(?:\s+ID)?:\s*([^\n]+)/,
      );
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
        .replace(
          /(?:Context from conversation:|Conversation context:).*?(?=Current query:|Query:|$)/s,
          '',
        )
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
      contextInfo,
    };
  }

  /**
   * Check if the query is a CostKatana-specific query.
   */
  private isCostKatanaQuery(query: string): boolean {
    const lowerCaseQuery = query.toLowerCase();
    return (
      lowerCaseQuery.includes('costkatana') ||
      lowerCaseQuery.includes('cost kata')
    );
  }

  /**
   * Determine if we should use AI-enhanced RAG approach vs traditional vector search
   */
  private shouldUseAIRAG(query: string): boolean {
    const lowerQuery = query.toLowerCase();

    // Use AI RAG for:
    // 1. Complex questions requiring synthesis
    // 2. Questions about integration or implementation
    // 3. Questions asking for examples or code
    // 4. Questions about best practices or recommendations
    // 5. Questions that need contextual understanding

    const aiRagKeywords = [
      'how to',
      'integrate',
      'implement',
      'example',
      'code',
      'best practice',
      'recommend',
      'setup',
      'configure',
      'install',
      'use',
      'tutorial',
      'guide',
      'step by step',
      'walkthrough',
      'explanation',
      'understand',
    ];

    return aiRagKeywords.some((keyword) => lowerQuery.includes(keyword));
  }

  /**
   * Generate response using AI-enhanced RAG (Retrieval-Augmented Generation)
   */
  private async generateAIRAGResponse(
    query: string,
    contextInfo: any,
  ): Promise<string> {
    const startTime = Date.now();

    try {
      loggingService.info('🤖 Using Modular RAG for knowledge base query', {
        component: 'knowledgeBaseTool',
        query: query,
        approach: 'modular_rag',
      });

      // Use Modular RAG Orchestrator
      const { modularRAGOrchestrator } = await import('../rag');

      const ragContext: any = {
        userId: contextInfo.userId,
        conversationId: contextInfo.conversationId,
      };

      // Execute with iterative pattern for comprehensive knowledge base queries
      const ragResult = await modularRAGOrchestrator.execute({
        query,
        context: ragContext,
        preferredPattern: 'iterative', // Use iterative for thorough knowledge base responses
      });

      const duration = Date.now() - startTime;

      if (ragResult.success && ragResult.answer) {
        loggingService.info('🤖 Modular RAG response generated successfully', {
          component: 'knowledgeBaseTool',
          query: query,
          pattern: ragResult.metadata.pattern,
          documentsUsed: ragResult.documents.length,
          responseLength: ragResult.answer.length,
          duration: duration,
        });

        return `🤖 **Knowledge Base Response:**\n\n${ragResult.answer}\n\n📊 **Sources:** ${ragResult.sources.join(', ')}`;
      } else {
        // Fallback if RAG fails
        return this.generateVectorSearchResponse(
          query,
          query,
          false,
          contextInfo,
          startTime,
        );
      }
    } catch (error) {
      loggingService.error(
        '🤖 Modular RAG failed, falling back to vector search',
        {
          component: 'knowledgeBaseTool',
          query: query,
          error: error instanceof Error ? error.message : String(error),
        },
      );

      // Fallback to traditional vector search
      return await this.generateVectorSearchResponse(
        query,
        query,
        false,
        contextInfo,
        startTime,
      );
    }
  }

  /**
   * Generate response using traditional vector search approach
   */
  private async generateVectorSearchResponse(
    query: string,
    coreQuery: string,
    hasContext: boolean,
    contextInfo: any,
    startTime: number,
  ): Promise<string> {
    // Search the vector store with the core query for better results
    const results = await getVectorStoreService().search(coreQuery, 7);

    if (results.length === 0) {
      loggingService.warn('No knowledge base results found', {
        component: 'knowledgeBaseTool',
        query: query,
      });
      return `No relevant information found in the CostKatana knowledge base for: "${query}"

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

    categories.forEach((category) => {
      const categoryResults = categorizedResults[category];
      if (categoryResults.length > 0) {
        response += `📚 **${category.toUpperCase()}**\n`;

        categoryResults.forEach((doc, index) => {
          const source = this.extractSourceName(doc.metadata.source);
          const relevanceScore = doc.metadata.score
            ? ` (${Math.round(doc.metadata.score * 100)}% relevant)`
            : '';

          response += `\n${index + 1}. **${source}**${relevanceScore}\n`;
          response += `${this.formatContent(doc.pageContent)}\n`;
        });
        response += '\n';
      }
    });

    // Add contextual recommendations
    response += this.generateRecommendations(query);

    const duration = Date.now() - startTime;

    loggingService.info('Knowledge base search completed', {
      component: 'knowledgeBaseTool',
      query: query,
      resultsCount: results.length,
      categoriesFound: categories.length,
      duration: duration,
    });

    return response;
  }

  /**
   * Handle CostKatana-specific queries to provide more accurate responses.
   */
  private handleCostKatanaQuery(query: string): string {
    const lowerQuery = query.toLowerCase();

    // Handle npm package queries
    if (lowerQuery.includes('npm') && lowerQuery.includes('package')) {
      return (
        `📦 **CostKatana NPM Packages:**\n\n` +
        `**Available NPM Packages:**\n` +
        `• **cost-katana** - Core library for AI cost tracking and optimization\n` +
        `  📦 Install: \`npm install cost-katana\`\n` +
        `  🔗 Package: https://www.npmjs.com/package/cost-katana\n\n` +
        `• **cost-katana-cli** - Command-line interface for AI cost optimization\n` +
        `  📦 Install: \`npm install -g cost-katana-cli\`\n` +
        `  🔗 Package: https://www.npmjs.com/package/cost-katana-cli\n\n` +
        `**Key Features:**\n` +
        `• Provider abstraction across multiple AI services\n` +
        `• Real-time cost tracking and analytics\n` +
        `• Cortex meta-language optimization (40-75% token reduction)\n` +
        `• Automatic failover and intelligent routing\n` +
        `• Comprehensive error handling and retry logic`
      );
    }

    // Handle CLI queries
    if (
      lowerQuery.includes('cli') ||
      (lowerQuery.includes('command') && lowerQuery.includes('line'))
    ) {
      return (
        `💻 **CostKatana CLI Tool:**\n\n` +
        `**Available CLI Package:**\n` +
        `• **cost-katana-cli** - Command-line interface for AI cost optimization\n` +
        `  📦 Install: \`npm install -g cost-katana-cli\`\n` +
        `  🔗 Package: https://www.npmjs.com/package/cost-katana-cli\n\n` +
        `**Key CLI Features:**\n` +
        `• Interactive chat sessions with AI models\n` +
        `• Cost analysis and optimization workflows\n` +
        `• Bulk processing and batch operations\n` +
        `• Cortex optimization for 40-75% token reduction\n` +
        `• Budget management and cost monitoring\n` +
        `• Multi-step workflow crafting and evaluation\n` +
        `• Cost simulation and what-if scenarios\n` +
        `• Intelligent prompt rewriting\n` +
        `• Model management and comparison\n\n` +
        `**Quick Start:**\n` +
        `\`\`\`bash\n` +
        `# Install globally\n` +
        `npm install -g cost-katana-cli\n\n` +
        `# Initialize configuration\n` +
        `cost-katana init\n\n` +
        `# Test setup\n` +
        `cost-katana test\n\n` +
        `# Start interactive chat\n` +
        `cost-katana chat --model nova-lite\n\n` +
        `# Optimize with Cortex (40-75% savings)\n` +
        `cost-katana optimize --prompt "your query" --cortex\n\n` +
        `# Analyze costs\n` +
        `cost-katana analyze --days 30\n\n` +
        `# List available models\n` +
        `cost-katana list-models\n` +
        `\`\`\``
      );
    }

    // Handle queries asking which CLI for python/javascript
    if (
      lowerQuery.includes('which') &&
      lowerQuery.includes('cli') &&
      (lowerQuery.includes('python') || lowerQuery.includes('javascript'))
    ) {
      return (
        `🔍 **CostKatana CLI Tools for Python and JavaScript:**\n\n` +
        `**JavaScript/TypeScript CLI:**\n` +
        `• **cost-katana-cli** (NPM package)\n` +
        `  📦 Install: \`npm install -g cost-katana-cli\`\n` +
        `  🔗 https://www.npmjs.com/package/cost-katana-cli\n\n` +
        `**Python CLI:**\n` +
        `• **cost-katana** (PyPI package) - Includes CLI functionality\n` +
        `  📦 Install: \`pip install cost-katana\`\n` +
        `  🔗 https://pypi.org/project/cost-katana/\n\n` +
        `**Important Notes:**\n` +
        `• CostKatana does NOT have separate CLI packages like \`costkatana-cli\`\n` +
        `• The main packages include CLI functionality\n` +
        `• Both packages provide command-line interfaces for cost optimization\n` +
        `• Use the official packages listed above, not hypothetical packages`
      );
    }

    // Handle Python package queries
    if (lowerQuery.includes('python') || lowerQuery.includes('pypi')) {
      return (
        `🐍 **CostKatana Python Package:**\n\n` +
        `**Available PyPI Package:**\n` +
        `• **cost-katana** - Python SDK for AI cost optimization with Cortex meta-language\n` +
        `  📦 Install: \`pip install cost-katana\`\n` +
        `  🔗 Package: https://pypi.org/project/cost-katana/\n\n` +
        `**Key Features:**\n` +
        `• Cortex meta-language for 40-75% token reduction\n` +
        `• SAST (Semantic Abstract Syntax Tree) processing\n` +
        `• Multi-provider support (OpenAI, Anthropic, Google, AWS Bedrock)\n` +
        `• Real-time cost tracking and analytics\n` +
        `• Chat sessions and conversation management\n` +
        `• Comprehensive error handling and retry logic\n` +
        `• Advanced configuration and environment management\n\n` +
        `**Quick Start:**\n` +
        `\`\`\`python\n` +
        `import cost_katana as ck\n\n` +
        `# Configure with API key\n` +
        `ck.configure(api_key='dak_your_key_here')\n\n` +
        `# Use any AI model\n` +
        `model = ck.GenerativeModel('nova-lite')\n` +
        `response = model.generate_content('Hello, world!')\n` +
        `print(f'Cost: \${response.usage_metadata.cost:.4f}')\n\n` +
        `# Enable Cortex optimization\n` +
        `response = model.generate_content(\n` +
        `    'Complex query here',\n` +
        `    cortex={'enabled': True, 'mode': 'answer_generation'}\n` +
        `)\n` +
        `print(f'Token reduction: {response.cortex_metadata.token_reduction}%')\n` +
        `\`\`\``
      );
    }

    // Handle backend URL queries
    if (lowerQuery.includes('backend') && lowerQuery.includes('url')) {
      return (
        `🔗 **CostKatana Backend URL Information:**\n\n` +
        `**Backend API URL:** https://api.costkatana.com\n\n` +
        `**Key Information:**\n` +
        `• This is the primary API endpoint for all CostKatana services\n` +
        `• Use this URL for API integrations and SDK configurations\n` +
        `• The backend provides authentication, cost tracking, and optimization services\n` +
        `• Health check endpoint: https://api.costkatana.com/api/health\n\n` +
        `**Configuration Examples:**\n` +
        `• Environment variable: \`COST_KATANA_BASE_URL=https://api.costkatana.com\`\n` +
        `• SDK configuration: \`baseUrl: 'https://api.costkatana.com'\`\n` +
        `• CLI configuration: \`cost-katana config --set baseUrl=https://api.costkatana.com\``
      );
    }

    // Handle API endpoint queries
    if (lowerQuery.includes('api') && lowerQuery.includes('endpoint')) {
      return (
        `🔌 **CostKatana API Endpoints:**\n\n` +
        `**Base URL:** https://api.costkatana.com\n\n` +
        `**Key Endpoints:**\n` +
        `• **Authentication:** \`POST /auth/login\` - User authentication\n` +
        `• **Cost Tracking:** \`POST /api/track\` - Track API usage and costs\n` +
        `• **Model Management:** \`GET /api/models\` - List available AI models\n` +
        `• **Analytics:** \`GET /api/analytics\` - Usage analytics and insights\n` +
        `• **Webhooks:** \`POST /api/webhooks\` - Configure webhook notifications\n` +
        `• **Health Check:** \`GET /api/health\` - Service health status\n\n` +
        `**Authentication:** All API requests require the \`Authorization: Bearer <API_KEY>\` header\n` +
        `**API Key Format:** Keys must start with \`dak_\` (e.g., \`dak_your_key_here\`)`
      );
    }

    return (
      `💡 **CostKatana Package Information:**\n\n` +
      `CostKatana provides comprehensive cost optimization solutions for AI applications through these official packages:\n\n` +
      `**📦 NPM Packages:**\n` +
      `• **cost-katana** - Core library for AI cost tracking and optimization\n` +
      `  📦 Install: \`npm install cost-katana\`\n` +
      `  🔗 https://www.npmjs.com/package/cost-katana\n\n` +
      `• **cost-katana-cli** - Command-line interface for AI cost optimization\n` +
      `  📦 Install: \`npm install -g cost-katana-cli\`\n` +
      `  🔗 https://www.npmjs.com/package/cost-katana-cli\n\n` +
      `**🐍 PyPI Package:**\n` +
      `• **cost-katana** - Python SDK for AI cost optimization with Cortex meta-language\n` +
      `  📦 Install: \`pip install cost-katana\`\n` +
      `  🔗 https://pypi.org/project/cost-katana/\n\n` +
      `**Backend URL:** https://api.costkatana.com\n` +
      `**Documentation:** https://docs.costkatana.com\n` +
      `**Dashboard:** https://costkatana.com/dashboard\n\n` +
      `**Note:** CostKatana does NOT have packages like \`costkatana-cli\`, \`@costkatana/sdk\`, or other hypothetical packages. Please use the official packages listed above.`
    );
  }
}
