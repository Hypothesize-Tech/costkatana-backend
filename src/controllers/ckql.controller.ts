import { Request, Response } from 'express';
import { ckqlService } from '../services/ckql.service';
import { telemetryVectorizationService } from '../services/telemetryVectorization.service';
import { loggingService } from '../services/logging.service';

export class CKQLController {
  /**
   * Execute natural language query
   */
  static async executeQuery(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { query, tenant_id, workspace_id, timeframe, limit, offset } = req.body;

    try {
      loggingService.info('CKQL query execution initiated', {
        queryLength: query?.length || 0,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        timeframe,
        limit: parseInt(limit) || 50,
        offset: parseInt(offset) || 0,
        requestId: req.headers['x-request-id'] as string
      });

      if (!query || typeof query !== 'string') {
        loggingService.warn('CKQL query execution failed - invalid query', {
          hasQuery: !!query,
          queryType: typeof query,
          requestId: req.headers['x-request-id'] as string
        });

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

      const duration = Date.now() - startTime;

      loggingService.info('CKQL query executed successfully', {
        queryLength: query.length,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        duration,
        executionTime: result.executionTime,
        totalCount: result.totalCount,
        resultsCount: result.results?.length || 0,
        hasInsights: !!result.insights,
        hasSuggestedFilters: !!result.query.suggestedFilters,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'ckql_query_executed',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          queryLength: query.length,
          tenantId: tenant_id,
          workspaceId: workspace_id,
          executionTime: result.executionTime,
          totalCount: result.totalCount,
          resultsCount: result.results?.length || 0,
          hasInsights: !!result.insights
        }
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
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('CKQL query execution failed', {
        queryLength: query?.length || 0,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();
    const { partial_query } = req.query;

    try {
      loggingService.info('CKQL suggestions request initiated', {
        partialQuery: partial_query,
        partialQueryLength: partial_query?.length || 0,
        requestId: req.headers['x-request-id'] as string
      });

      if (!partial_query || typeof partial_query !== 'string') {
        loggingService.warn('CKQL suggestions failed - invalid partial query', {
          hasPartialQuery: !!partial_query,
          partialQueryType: typeof partial_query,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(400).json({
          success: false,
          error: 'partial_query is required'
        });
      }

      const suggestions = CKQLController.generateSuggestions(partial_query);

      const duration = Date.now() - startTime;

      loggingService.info('CKQL suggestions generated successfully', {
        partialQuery: partial_query,
        partialQueryLength: partial_query.length,
        suggestionsCount: suggestions.length,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'ckql_suggestions_generated',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          partialQuery: partial_query,
          partialQueryLength: partial_query.length,
          suggestionsCount: suggestions.length
        }
      });

      return res.json({
        success: true,
        suggestions
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to get query suggestions', {
        partialQuery: partial_query,
        partialQueryLength: partial_query?.length || 0,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();
    const { timeframe, tenant_id, workspace_id, force_reprocess } = req.body;

    try {
      loggingService.info('Telemetry vectorization initiated', {
        timeframe,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        forceReprocess: force_reprocess,
        requestId: req.headers['x-request-id'] as string
      });

      const job = await telemetryVectorizationService.startVectorization({
        timeframe,
        tenant_id,
        workspace_id,
        forceReprocess: force_reprocess
      });

      const duration = Date.now() - startTime;

      loggingService.info('Telemetry vectorization started successfully', {
        timeframe,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        forceReprocess: force_reprocess,
        jobId: job.id,
        jobStatus: job.status,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'telemetry_vectorization_started',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          timeframe,
          tenantId: tenant_id,
          workspaceId: workspace_id,
          forceReprocess: force_reprocess,
          jobId: job.id,
          jobStatus: job.status
        }
      });

      return res.json({
        success: true,
        job
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to start vectorization', {
        timeframe,
        tenantId: tenant_id,
        workspaceId: workspace_id,
        forceReprocess: force_reprocess,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();
    const tenant_id = req.query.tenant_id as string;
    const workspace_id = req.query.workspace_id as string;

    try {
      loggingService.info('Vectorization status request initiated', {
        tenantId: tenant_id,
        workspaceId: workspace_id,
        requestId: req.headers['x-request-id'] as string
      });

      const job: any = await telemetryVectorizationService.getJobStatus();
      const stats = await telemetryVectorizationService.getVectorizationStats({
        tenant_id,
        workspace_id
      });

      const duration = Date.now() - startTime;

      loggingService.info('Vectorization status retrieved successfully', {
        tenantId: tenant_id,
        workspaceId: workspace_id,
        duration,
        jobStatus: job?.status,
        jobId: job?.id,
        hasStats: !!stats,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'vectorization_status_retrieved',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          tenantId: tenant_id,
          workspaceId: workspace_id,
          jobStatus: job?.status,
          jobId: job?.id,
          hasStats: !!stats
        }
      });

      return res.json({
        success: true,
        current_job: job,
        statistics: stats
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to get vectorization status', {
        tenantId: tenant_id,
        workspaceId: workspace_id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();

    try {
      loggingService.info('Vectorization cancellation initiated', {
        requestId: _req.headers['x-request-id'] as string
      });

      const cancelled = await telemetryVectorizationService.cancelVectorization();

      const duration = Date.now() - startTime;

      loggingService.info('Vectorization cancellation completed', {
        duration,
        cancelled,
        requestId: _req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'vectorization_cancelled',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          cancelled
        }
      });

      return res.json({
        success: true,
        cancelled
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to cancel vectorization', {
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: _req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();
    const { record_ids } = req.body;

    try {
      loggingService.info('Cost narratives request initiated', {
        recordIdsCount: record_ids?.length || 0,
        recordIds: record_ids,
        requestId: req.headers['x-request-id'] as string
      });

      if (!Array.isArray(record_ids)) {
        loggingService.warn('Cost narratives failed - invalid record IDs', {
          hasRecordIds: !!record_ids,
          recordIdsType: typeof record_ids,
          requestId: req.headers['x-request-id'] as string
        });

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

      const duration = Date.now() - startTime;

      loggingService.info('Cost narratives generated successfully', {
        recordIdsCount: record_ids.length,
        recordIds: record_ids,
        narrativesCount: narratives.length,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_narratives_generated',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          recordIdsCount: record_ids.length,
          recordIds: record_ids,
          narrativesCount: narratives.length
        }
      });

      return res.json({
        success: true,
        narratives
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to get cost narratives', {
        recordIdsCount: record_ids?.length || 0,
        recordIds: record_ids,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

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
    const startTime = Date.now();

    try {
      loggingService.info('Example queries request initiated', {
        requestId: _req.headers['x-request-id'] as string
      });

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

      const duration = Date.now() - startTime;

      loggingService.info('Example queries retrieved successfully', {
        duration,
        categoriesCount: examples.length,
        totalQueriesCount: examples.reduce((sum, cat) => sum + cat.queries.length, 0),
        requestId: _req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'example_queries_retrieved',
        category: 'ckql_operations',
        value: duration,
        metadata: {
          categoriesCount: examples.length,
          totalQueriesCount: examples.reduce((sum, cat) => sum + cat.queries.length, 0)
        }
      });

      return res.json({
        success: true,
        examples
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Failed to get example queries', {
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: _req.headers['x-request-id'] as string
      });

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

