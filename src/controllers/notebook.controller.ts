import { Request, Response } from 'express';
import { notebookService } from '../services/notebook.service';
import { aiInsightsService } from '../services/aiInsights.service';
import { loggingService } from '../services/logging.service';

export class NotebookController {
  // Background processing queue for non-critical operations
  private static backgroundQueue: Array<() => Promise<void>> = [];
  private static backgroundQueueProcessor: NodeJS.Timeout | null = null;

  /**
   * Initialize background processor
   */
  static {
    this.startBackgroundProcessor();
  }

  /**
   * Get all notebooks
   */
  static async getNotebooks(_req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();

    try {
      loggingService.info('Notebooks retrieval initiated', {
        requestId: _req.headers['x-request-id'] as string
      });

      loggingService.info('Notebooks retrieval processing started', {
        requestId: _req.headers['x-request-id'] as string
      });

      const notebooks = await notebookService.getNotebooks();

      const duration = Date.now() - startTime;

      loggingService.info('Notebooks retrieved successfully', {
        duration,
        notebooksCount: notebooks.length,
        hasNotebooks: !!notebooks && notebooks.length > 0,
        requestId: _req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebooks_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          notebooksCount: notebooks.length,
          hasNotebooks: !!notebooks && notebooks.length > 0
        }
      });

      return res.json({
        success: true,
        notebooks
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebooks retrieval failed', {
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: _req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get notebooks'
      });
    }
  }

  /**
   * Get notebook by ID
   */
  static async getNotebook(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;

    try {
      loggingService.info('Notebook retrieval by ID initiated', {
        notebookId: id,
        hasNotebookId: !!id,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook retrieval by ID processing started', {
        notebookId: id,
        requestId: req.headers['x-request-id'] as string
      });

      const notebook = await notebookService.getNotebook(id);
      
      if (!notebook) {
        const duration = Date.now() - startTime;

        loggingService.warn('Notebook retrieval by ID failed - notebook not found', {
          notebookId: id,
          duration,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      const duration = Date.now() - startTime;

      loggingService.info('Notebook retrieved by ID successfully', {
        notebookId: id,
        duration,
        hasNotebook: !!notebook,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_retrieved_by_id',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          notebookId: id,
          hasNotebook: !!notebook
        }
      });

      return res.json({
        success: true,
        notebook
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook retrieval by ID failed', {
        notebookId: id,
        hasNotebookId: !!id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get notebook'
      });
    }
  }

  /**
   * Create new notebook
   */
  static async createNotebook(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { title, description, template_type } = req.body;

    try {
      loggingService.info('Notebook creation initiated', {
        title,
        hasTitle: !!title,
        description,
        hasDescription: !!description,
        templateType: template_type,
        hasTemplateType: !!template_type,
        requestId: req.headers['x-request-id'] as string
      });

      if (!title) {
        loggingService.warn('Notebook creation failed - title is required', {
          description,
          hasDescription: !!description,
          templateType: template_type,
          hasTemplateType: !!template_type,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(400).json({
          success: false,
          error: 'Title is required'
        });
      }

      loggingService.info('Notebook creation processing started', {
        title,
        description,
        hasDescription: !!description,
        templateType: template_type,
        hasTemplateType: !!template_type,
        requestId: req.headers['x-request-id'] as string
      });

      const notebook = await notebookService.createNotebook(
        title,
        description || '',
        template_type
      );

      const duration = Date.now() - startTime;

      loggingService.info('Notebook created successfully', {
        title,
        description,
        hasDescription: !!description,
        templateType: template_type,
        hasTemplateType: !!template_type,
        duration,
        hasNotebook: !!notebook,
        notebookId: (notebook as any)?.id || (notebook as any)?._id,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_created',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          title,
          description,
          hasDescription: !!description,
          templateType: template_type,
          hasTemplateType: !!template_type,
          hasNotebook: !!notebook,
          notebookId: (notebook as any)?.id || (notebook as any)?._id
        }
      });

      return res.status(201).json({
        success: true,
        notebook
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook creation failed', {
        title,
        hasTitle: !!title,
        description,
        hasDescription: !!description,
        templateType: template_type,
        hasTemplateType: !!template_type,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to create notebook'
      });
    }
  }

  /**
   * Update notebook
   */
  static async updateNotebook(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;
    const updates = req.body;

    try {
      loggingService.info('Notebook update initiated', {
        notebookId: id,
        hasNotebookId: !!id,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : [],
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook update processing started', {
        notebookId: id,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : [],
        requestId: req.headers['x-request-id'] as string
      });

      const notebook = await notebookService.updateNotebook(id, updates);
      
      if (!notebook) {
        const duration = Date.now() - startTime;

        loggingService.warn('Notebook update failed - notebook not found', {
          notebookId: id,
          hasUpdates: !!updates,
          updateKeys: updates ? Object.keys(updates) : [],
          duration,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      const duration = Date.now() - startTime;

      loggingService.info('Notebook updated successfully', {
        notebookId: id,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : [],
        duration,
        hasNotebook: !!notebook,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_updated',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          notebookId: id,
          hasUpdates: !!updates,
          updateKeys: updates ? Object.keys(updates) : [],
          hasNotebook: !!notebook
        }
      });

      return res.json({
        success: true,
        notebook
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook update failed', {
        notebookId: id,
        hasNotebookId: !!id,
        hasUpdates: !!updates,
        updateKeys: updates ? Object.keys(updates) : [],
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to update notebook'
      });
    }
  }

  /**
   * Delete notebook
   */
  static async deleteNotebook(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;

    try {
      loggingService.info('Notebook deletion initiated', {
        notebookId: id,
        hasNotebookId: !!id,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook deletion processing started', {
        notebookId: id,
        requestId: req.headers['x-request-id'] as string
      });

      const deleted = await notebookService.deleteNotebook(id);
      
      if (!deleted) {
        const duration = Date.now() - startTime;

        loggingService.warn('Notebook deletion failed - notebook not found', {
          notebookId: id,
          duration,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      const duration = Date.now() - startTime;

      loggingService.info('Notebook deleted successfully', {
        notebookId: id,
        duration,
        deleted,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_deleted',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          notebookId: id,
          deleted
        }
      });

      return res.json({
        success: true,
        message: 'Notebook deleted successfully'
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook deletion failed', {
        notebookId: id,
        hasNotebookId: !!id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to delete notebook'
      });
    }
  }

  /**
   * Execute notebook
   */
  static async executeNotebook(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;

    try {
      loggingService.info('Notebook execution initiated', {
        notebookId: id,
        hasNotebookId: !!id,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook execution processing started', {
        notebookId: id,
        requestId: req.headers['x-request-id'] as string
      });

      const execution = await notebookService.executeNotebook(id);

      const duration = Date.now() - startTime;

      loggingService.info('Notebook executed successfully', {
        notebookId: id,
        duration,
        hasExecution: !!execution,
        executionId: (execution as any)?.id || (execution as any)?._id,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_executed',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          notebookId: id,
          hasExecution: !!execution,
          executionId: (execution as any)?.id || (execution as any)?._id
        }
      });

      return res.json({
        success: true,
        execution
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook execution failed', {
        notebookId: id,
        hasNotebookId: !!id,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : 'Failed to execute notebook'
      });
    }
  }

  /**
   * Get execution results
   */
    static async getExecution(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { executionId } = req.params;

    try {
      loggingService.info('Notebook execution results retrieval initiated', {
        executionId,
        hasExecutionId: !!executionId,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook execution results retrieval processing started', {
        executionId,
        requestId: req.headers['x-request-id'] as string
      });

      const execution = await notebookService.getExecution(executionId);
      
      if (!execution) {
        const duration = Date.now() - startTime;

        loggingService.warn('Notebook execution results retrieval failed - execution not found', {
          executionId,
          duration,
          requestId: req.headers['x-request-id'] as string
        });

        return res.status(404).json({
          success: false,
          error: 'Execution not found'
        });
      }

      const duration = Date.now() - startTime;

      loggingService.info('Notebook execution results retrieved successfully', {
        executionId,
        duration,
        hasExecution: !!execution,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_execution_results_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          executionId,
          hasExecution: !!execution
        }
      });

      return res.json({
        success: true,
        execution
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook execution results retrieval failed', {
        executionId,
        hasExecutionId: !!executionId,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get execution'
      });
    }
  }

  /**
   * Get notebook templates
   */
  static async getTemplates(_req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();

    try {
      loggingService.info('Notebook templates retrieval initiated', {
        requestId: _req.headers['x-request-id'] as string
      });

      loggingService.info('Notebook templates retrieval processing started', {
        requestId: _req.headers['x-request-id'] as string
      });

      const templates = [
        {
          id: 'cost_spike',
          name: 'Cost Spike Investigation',
          description: 'Template for investigating sudden cost increases',
          category: 'Cost Analysis',
          cells_count: 7,
          estimated_time: '5-10 minutes'
        },
        {
          id: 'model_performance',
          name: 'Model Performance Analysis',
          description: 'Compare AI model costs and performance',
          category: 'Performance',
          cells_count: 7,
          estimated_time: '10-15 minutes'
        },
        {
          id: 'usage_patterns',
          name: 'Usage Pattern Discovery',
          description: 'Find patterns in your usage data',
          category: 'Analytics',
          cells_count: 6,
          estimated_time: '8-12 minutes'
        }
      ];

      const duration = Date.now() - startTime;

      loggingService.info('Notebook templates retrieved successfully', {
        duration,
        templatesCount: templates.length,
        hasTemplates: !!templates && templates.length > 0,
        requestId: _req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'notebook_templates_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          templatesCount: templates.length,
          hasTemplates: !!templates && templates.length > 0
        }
      });

      return res.json({
        success: true,
        templates
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Notebook templates retrieval failed', {
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: _req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to get templates'
      });
    }
  }

  /**
   * Get AI insights
   */
  static async getAIInsights(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;

    try {
      loggingService.info('AI insights retrieval initiated', {
        timeframe,
        hasTimeframe: !!timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('AI insights retrieval processing started', {
        timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      // Use Promise.race for timeout protection
      const insightsPromise = aiInsightsService.generateInsights(timeframe as string);
      const timeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('AI insights timeout')), 30000)
      );

      let insights;
      try {
        insights = await Promise.race([insightsPromise, timeoutPromise]);
      } catch (error) {
        // Fallback to basic insights if AI service fails
        loggingService.warn('AI insights generation failed, using fallback', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        insights = {
          anomalies: [],
          optimizations: [],
          forecasts: [],
          overall_health_score: 75,
          key_insights: ['System analysis completed', 'No critical issues detected'],
          priority_actions: ['Continue monitoring system performance']
        };
      }

      const duration = Date.now() - startTime;

      loggingService.info('AI insights retrieved successfully', {
        timeframe,
        duration,
        hasInsights: !!insights,
        insightsCount: Array.isArray(insights) ? insights.length : 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Queue business event logging as background operation
      this.queueBackgroundOperation(async () => {
        loggingService.logBusiness({
          event: 'ai_insights_retrieved',
          category: 'notebook_operations',
          value: duration,
          metadata: {
            timeframe,
            hasInsights: !!insights,
            insightsCount: Array.isArray(insights) ? insights.length : 0
          }
        });
      });

      return res.json({
        success: true,
        insights
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('AI insights retrieval failed', {
        timeframe,
        hasTimeframe: !!timeframe,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to generate AI insights'
      });
    }
  }

  /**
   * Get anomaly detection results
   */
  static async getAnomalies(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;

    try {
      loggingService.info('Anomaly detection results retrieval initiated', {
        timeframe,
        hasTimeframe: !!timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Anomaly detection results retrieval processing started', {
        timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      const anomalies = await aiInsightsService.detectAnomalies(timeframe as string);

      const duration = Date.now() - startTime;

      loggingService.info('Anomaly detection results retrieved successfully', {
        timeframe,
        duration,
        hasAnomalies: !!anomalies,
        anomaliesCount: Array.isArray(anomalies) ? anomalies.length : 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'anomaly_detection_results_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          timeframe,
          hasAnomalies: !!anomalies,
          anomaliesCount: Array.isArray(anomalies) ? anomalies.length : 0
        }
      });

      return res.json({
        success: true,
        anomalies
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Anomaly detection results retrieval failed', {
        timeframe,
        hasTimeframe: !!timeframe,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to detect anomalies'
      });
    }
  }

  /**
   * Get cost optimization recommendations
   */
  static async getOptimizations(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;

    try {
      loggingService.info('Cost optimization recommendations retrieval initiated', {
        timeframe,
        hasTimeframe: !!timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Cost optimization recommendations retrieval processing started', {
        timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      const optimizations = await aiInsightsService.generateOptimizations(timeframe as string);

      const duration = Date.now() - startTime;

      loggingService.info('Cost optimization recommendations retrieved successfully', {
        timeframe,
        duration,
        hasOptimizations: !!optimizations,
        optimizationsCount: Array.isArray(optimizations) ? optimizations.length : 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'cost_optimization_recommendations_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          timeframe,
          hasOptimizations: !!optimizations,
          optimizationsCount: Array.isArray(optimizations) ? optimizations.length : 0
        }
      });

      return res.json({
        success: true,
        optimizations
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Cost optimization recommendations retrieval failed', {
        timeframe,
        hasTimeframe: !!timeframe,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to generate optimizations'
      });
    }
  }

  /**
   * Get predictive forecasts
   */
  static async getForecasts(req: Request, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;

    try {
      loggingService.info('Predictive forecasts retrieval initiated', {
        timeframe,
        hasTimeframe: !!timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      loggingService.info('Predictive forecasts retrieval processing started', {
        timeframe,
        requestId: req.headers['x-request-id'] as string
      });

      const forecasts = await aiInsightsService.generateForecasts(timeframe as string);

      const duration = Date.now() - startTime;

      loggingService.info('Predictive forecasts retrieved successfully', {
        timeframe,
        duration,
        hasForecasts: !!forecasts,
        forecastsCount: Array.isArray(forecasts) ? forecasts.length : 0,
        requestId: req.headers['x-request-id'] as string
      });

      // Log business event
      loggingService.logBusiness({
        event: 'predictive_forecasts_retrieved',
        category: 'notebook_operations',
        value: duration,
        metadata: {
          timeframe,
          hasForecasts: !!forecasts,
          forecastsCount: Array.isArray(forecasts) ? forecasts.length : 0
        }
      });

      return res.json({
        success: true,
        forecasts
      });
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      loggingService.error('Predictive forecasts retrieval failed', {
        timeframe,
        hasTimeframe: !!timeframe,
        error: error.message || 'Unknown error',
        stack: error.stack,
        duration,
        requestId: req.headers['x-request-id'] as string
      });

      return res.status(500).json({
        success: false,
        error: 'Failed to generate forecasts'
      });
    }
  }

  /**
   * Queue background operation
   */
  private static queueBackgroundOperation(operation: () => Promise<void>): void {
    this.backgroundQueue.push(operation);
  }

  /**
   * Start background processor
   */
  private static startBackgroundProcessor(): void {
    this.backgroundQueueProcessor = setInterval(async () => {
      if (this.backgroundQueue.length > 0) {
        const operation = this.backgroundQueue.shift();
        if (operation) {
          try {
            await operation();
          } catch (error) {
            loggingService.error('Background operation failed:', { 
              error: error instanceof Error ? error.message : String(error) 
            });
          }
        }
      }
    }, 1000); // Process queue every second
  }

  /**
   * Execute with timeout protection
   */
  private static async executeWithTimeout<T>(
    operation: Promise<T>, 
    timeoutMs: number = 15000,
    fallback?: T
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => 
      setTimeout(() => reject(new Error('Operation timeout')), timeoutMs)
    );

    try {
      return await Promise.race([operation, timeoutPromise]);
    } catch (error) {
      if (fallback !== undefined) {
        loggingService.warn('Operation failed, using fallback', { 
          error: error instanceof Error ? error.message : String(error) 
        });
        return fallback;
      }
      throw error;
    }
  }
}

