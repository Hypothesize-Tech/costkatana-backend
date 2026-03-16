import { Injectable, Inject } from '@nestjs/common';
import { BaseAgentTool } from './base-agent.tool';
import { VectorStoreService } from '../services/vector-store.service';

/**
 * Knowledge Base Tool Service
 * Searches the comprehensive CostKatana knowledge base for detailed information
 * Ported from Express KnowledgeBaseTool with NestJS patterns
 */
@Injectable()
export class KnowledgeBaseToolService extends BaseAgentTool {
  constructor(
    @Inject(VectorStoreService)
    private readonly vectorStore: VectorStoreService,
  ) {
    super(
      'knowledge_base_search',
      `Search the comprehensive CostKatana knowledge base for detailed information about:

CORE CAPABILITIES:
- AI usage optimization strategies (prompt compression, context trimming, model switching)
- Cortex meta-language system for advanced optimization
- Cost optimization techniques and usage efficiency
- AI insights and analytics (usage patterns, cost trends, predictive analytics)
- Multi-agent workflows and coordination patterns
- API integration guides and system architecture
- Security monitoring and threat detection
- Data analytics and reporting capabilities

SYSTEM INFORMATION:
- Current system components (controllers, services, infrastructure)
- Cortex architecture (Encoder, Core Processor, Decoder)
- Authentication patterns and API endpoints
- Real-time monitoring and observability features
- Webhook management and delivery systems

PACKAGE INFORMATION:
- NPM Package: cost-katana - Core library for AI cost tracking and optimization
- NPM Package: cost-katana-cli - Command-line interface
- PyPI Package: cost-katana - Python SDK with Cortex optimization

Input should be a specific question or search query about any aspect of the CostKatana.`,
    );
  }

  protected async executeLogic(input: any): Promise<any> {
    try {
      const query = typeof input === 'string' ? input : input.query || '';
      if (!query || query.trim().length === 0) {
        return this.createErrorResponse(
          'knowledge_base_search',
          'Query is required',
        );
      }

      // Search the vector store
      const results = await this.vectorStore.search(query, 7);

      if (results.length === 0) {
        return this.createSuccessResponse('knowledge_base_search', {
          message: 'No relevant information found in the knowledge base.',
          query,
          suggestions: [
            'Try rephrasing your question',
            'Check the CostKatana documentation',
            'Contact support for specific questions',
          ],
        });
      }

      // Format results
      const formattedResults = results.map((result) => ({
        content: result.content,
        metadata: result.metadata,
        relevanceScore: result.score,
      }));

      return this.createSuccessResponse('knowledge_base_search', {
        query,
        results: formattedResults,
        totalResults: results.length,
        message: `Found ${results.length} relevant results for "${query}"`,
      });
    } catch (error: any) {
      this.logger.error('Knowledge base search failed', {
        error: error.message,
        input,
      });
      return this.createErrorResponse('knowledge_base_search', error.message);
    }
  }
}
