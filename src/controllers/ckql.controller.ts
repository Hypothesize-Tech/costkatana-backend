import { Request, Response } from 'express';
import { ckqlService } from '../services/ckql.service';
import { telemetryVectorizationService } from '../services/telemetryVectorization.service';
import { logger } from '../utils/logger';

export class CKQLController {
  /**
   * Execute natural language query
   */
  static async executeQuery(req: Request, res: Response): Promise<Response> {
    try {
      const { query, tenant_id, workspace_id, timeframe, limit, offset } = req.body;

      if (!query || typeof query !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'Query is required and must be a string'
        });
      }

      // Parse the natural language query
      const ckqlQuery = await ckqlService.parseQuery(query, {
        tenant_id,
        workspace_id,
        timeframe
      });

      // Execute the query
      const result = await ckqlService.executeQuery(ckqlQuery, {
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0
      });

      return res.json({
        success: true,
        query: result.query.naturalLanguage,
        explanation: result.query.explanation,
        results: result.results,
        total_count: result.totalCount,
        execution_time_ms: result.executionTime,
        insights: result.insights,
        suggested_filters: result.query.suggestedFilters
      });
    } catch (error) {
      logger.error('CKQL query execution failed:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to execute query',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get query suggestions based on partial input
   */
  static async getSuggestions(req: Request, res: Response): Promise<Response> {
    try {
      const { partial_query } = req.query;

      if (!partial_query || typeof partial_query !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'partial_query is required'
        });
      }

      const suggestions = CKQLController.generateSuggestions(partial_query);

      return res.json({
        success: true,
        suggestions
      });
    } catch (error) {
      logger.error('Failed to get query suggestions:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get suggestions'
      });
    }
  }

  /**
   * Start vectorization of telemetry data
   */
  static async startVectorization(req: Request, res: Response): Promise<Response> {
    try {
      const { timeframe, tenant_id, workspace_id, force_reprocess } = req.body;

      const job = await telemetryVectorizationService.startVectorization({
        timeframe,
        tenant_id,
        workspace_id,
        forceReprocess: force_reprocess
      });

      return res.json({
        success: true,
        job
      });
    } catch (error) {
      logger.error('Failed to start vectorization:', error);
      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to start vectorization'
      });
    }
  }

  /**
   * Get vectorization job status
   */
  static async getVectorizationStatus(req: Request, res: Response): Promise<Response> {
    try {
      const job = await telemetryVectorizationService.getJobStatus();
      const stats = await telemetryVectorizationService.getVectorizationStats({
        tenant_id: req.query.tenant_id as string,
        workspace_id: req.query.workspace_id as string
      });

      return res.json({
        success: true,
        current_job: job,
        statistics: stats
      });
    } catch (error) {
      logger.error('Failed to get vectorization status:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get vectorization status'
      });
    }
  }

  /**
   * Cancel vectorization job
   */
  static async cancelVectorization(_req: Request, res: Response): Promise<Response> {
    try {
      const cancelled = await telemetryVectorizationService.cancelVectorization();

      return res.json({
        success: true,
        cancelled
      });
    } catch (error) {
      logger.error('Failed to cancel vectorization:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to cancel vectorization'
      });
    }
  }

  /**
   * Get cost narratives for specific records
   */
  static async getCostNarratives(req: Request, res: Response): Promise<Response> {
    try {
      const { record_ids } = req.body;

      if (!Array.isArray(record_ids)) {
        return res.status(400).json({
          success: false,
          error: 'record_ids must be an array'
        });
      }

      // This would typically fetch from the database
      // For now, return a placeholder response
      const narratives = record_ids.map(id => ({
        record_id: id,
        narrative: "Cost narrative will be generated based on telemetry data analysis.",
        generated_at: new Date().toISOString()
      }));

      return res.json({
        success: true,
        narratives
      });
    } catch (error) {
      logger.error('Failed to get cost narratives:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get cost narratives'
      });
    }
  }

  /**
   * Get example queries for different use cases
   */
  static async getExampleQueries(_req: Request, res: Response): Promise<Response> {
    try {
      const examples = [
        {
          category: "Cost Analysis",
          queries: [
            "What are my most expensive AI operations today?",
            "Show me operations that cost more than $0.01",
            "Which models are driving up my costs?",
            "Find expensive operations in the last hour"
          ]
        },
        {
          category: "Performance Analysis", 
          queries: [
            "What operations are taking longer than 5 seconds?",
            "Show me the slowest requests today",
            "Find performance bottlenecks in my API",
            "Which operations have high latency?"
          ]
        },
        {
          category: "Error Investigation",
          queries: [
            "What errors occurred in the last hour?",
            "Show me failed AI model calls",
            "Find operations with high error rates",
            "What's causing authentication failures?"
          ]
        },
        {
          category: "Usage Patterns",
          queries: [
            "How many requests per minute am I getting?",
            "What are my peak usage hours?",
            "Show me usage by service",
            "Find unusual traffic patterns"
          ]
        },
        {
          category: "Semantic Search",
          queries: [
            "Find operations similar to high-cost AI calls",
            "Show me patterns like yesterday's spike",
            "What operations behave like this trace?",
            "Find anomalies in my cost patterns"
          ]
        }
      ];

      return res.json({
        success: true,
        examples
      });
    } catch (error) {
      logger.error('Failed to get example queries:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to get example queries'
      });
    }
  }

  /**
   * Generate query suggestions based on partial input
   */
  private static generateSuggestions(partialQuery: string): string[] {
    const suggestions: string[] = [];
    const lower = partialQuery.toLowerCase();

    // Cost-related suggestions
    if (lower.includes('cost') || lower.includes('expensive') || lower.includes('$')) {
      suggestions.push(
        "What are my most expensive operations today?",
        "Show me operations that cost more than $0.01",
        "Find high-cost AI model calls",
        "Which operations are driving up costs?"
      );
    }

    // Performance-related suggestions
    if (lower.includes('slow') || lower.includes('latency') || lower.includes('performance')) {
      suggestions.push(
        "What operations are taking longer than 5 seconds?",
        "Show me the slowest requests today",
        "Find performance bottlenecks",
        "Which operations have high latency?"
      );
    }

    // Error-related suggestions
    if (lower.includes('error') || lower.includes('fail') || lower.includes('problem')) {
      suggestions.push(
        "What errors occurred in the last hour?",
        "Show me failed operations",
        "Find operations with high error rates",
        "What's causing failures?"
      );
    }

    // AI/Model-related suggestions
    if (lower.includes('ai') || lower.includes('model') || lower.includes('claude') || lower.includes('gpt')) {
      suggestions.push(
        "Show me AI model usage today",
        "What are my most expensive AI calls?",
        "Find failed AI operations",
        "Which models am I using most?"
      );
    }

    // Time-related suggestions
    if (lower.includes('today') || lower.includes('hour') || lower.includes('yesterday')) {
      suggestions.push(
        "Show me today's operations",
        "What happened in the last hour?",
        "Find yesterday's peak usage",
        "Show me this week's trends"
      );
    }

    // Default suggestions if no specific patterns found
    if (suggestions.length === 0) {
      suggestions.push(
        "What are my most expensive operations?",
        "Show me recent errors",
        "Find slow operations",
        "What's my current usage?"
      );
    }

    return suggestions.slice(0, 6); // Return max 6 suggestions
  }
}

