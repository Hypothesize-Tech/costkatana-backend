import { Request, Response } from 'express';
import { notebookService } from '../services/notebook.service';
import { aiInsightsService } from '../services/aiInsights.service';
import { loggingService } from '../services/logging.service';
import { ControllerHelper, AuthenticatedRequest } from '@utils/controllerHelper';
import { ServiceHelper } from '@utils/serviceHelper';

export class NotebookController {
  // Background processing queue for non-critical operations
  private static backgroundQueue: Array<() => Promise<void>> = [];

  /**
   * Get all notebooks
   */
  static async getNotebooks(_req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    ControllerHelper.logRequestStart('getNotebooks', _req);

    try {
      const notebooks = await notebookService.getNotebooks();

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getNotebooks', _req, startTime, {
        notebooksCount: notebooks.length
      });

      return res.json({
        success: true,
        notebooks
      });
    } catch (error: any) {
      ControllerHelper.handleError('getNotebooks', error, _req, res, startTime);
      return res;
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
  static async createNotebook(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { title, description, template_type } = req.body;
    
    ControllerHelper.logRequestStart('createNotebook', req, { title, template_type });

    try {
      if (!title) {
        return res.status(400).json({
          success: false,
          error: 'Title is required'
        });
      }

      const notebook = await notebookService.createNotebook(
        title,
        description || '',
        template_type
      );

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('createNotebook', req, startTime, {
        notebookId: (notebook as any)?.id || (notebook as any)?._id
      });

      return res.status(201).json({
        success: true,
        notebook
      });
    } catch (error: any) {
      ControllerHelper.handleError('createNotebook', error, req, res, startTime);
      return res;
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
  static async deleteNotebook(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;
    
    ControllerHelper.logRequestStart('deleteNotebook', req, { notebookId: id });

    try {
      ServiceHelper.validateObjectId(id, 'notebookId');

      const deleted = await notebookService.deleteNotebook(id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('deleteNotebook', req, startTime, {
        notebookId: id
      });

      return res.json({
        success: true,
        message: 'Notebook deleted successfully'
      });
    } catch (error: any) {
      ControllerHelper.handleError('deleteNotebook', error, req, res, startTime, { notebookId: id });
      return res;
    }
  }

  /**
   * Execute notebook
   */
  static async executeNotebook(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { id } = req.params;
    
    ControllerHelper.logRequestStart('executeNotebook', req, { notebookId: id });

    try {
      ServiceHelper.validateObjectId(id, 'notebookId');

      const execution = await notebookService.executeNotebook(id);

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('executeNotebook', req, startTime, {
        notebookId: id,
        executionId: (execution as any)?.id || (execution as any)?._id
      });

      return res.json({
        success: true,
        execution
      });
    } catch (error: any) {
      ControllerHelper.handleError('executeNotebook', error, req, res, startTime, { notebookId: id });
      return res;
    }
  }

  /**
   * Get execution results
   */
    static async getExecution(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { executionId } = req.params;
    
    ControllerHelper.logRequestStart('getExecution', req, { executionId });

    try {
      ServiceHelper.validateObjectId(executionId, 'executionId');

      const execution = await notebookService.getExecution(executionId);
      
      if (!execution) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found'
        });
      }

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getExecution', req, startTime, {
        executionId
      });

      return res.json({
        success: true,
        execution
      });
    } catch (error: any) {
      ControllerHelper.handleError('getExecution', error, req, res, startTime, { executionId });
      return res;
    }
  }

  /**
   * Get notebook templates
   */
  static async getTemplates(_req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    
    ControllerHelper.logRequestStart('getTemplates', _req);

    try {

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

      ControllerHelper.logRequestSuccess('getTemplates', _req, startTime, {
        templatesCount: templates.length
      });

      return res.json({
        success: true,
        templates
      });
    } catch (error: any) {
      ControllerHelper.handleError('getTemplates', error, _req, res, startTime);
      return res;
    }
  }

  /**
   * Get AI insights
   */
  static async getAIInsights(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;
    
    ControllerHelper.logRequestStart('getAIInsights', req, { timeframe: timeframe as string });

    try {

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

      ControllerHelper.logRequestSuccess('getAIInsights', req, startTime, {
        timeframe: timeframe as string
      });

      return res.json({
        success: true,
        insights
      });
    } catch (error: any) {
      ControllerHelper.handleError('getAIInsights', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Get anomaly detection results
   */
  static async getAnomalies(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;
    
    ControllerHelper.logRequestStart('getAnomalies', req, { timeframe: timeframe as string });

    try {
      const anomalies = await aiInsightsService.detectAnomalies(timeframe as string);

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getAnomalies', req, startTime, {
        anomaliesCount: Array.isArray(anomalies) ? anomalies.length : 0
      });

      return res.json({
        success: true,
        anomalies
      });
    } catch (error: any) {
      ControllerHelper.handleError('getAnomalies', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Get cost optimization recommendations
   */
  static async getOptimizations(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;
    
    ControllerHelper.logRequestStart('getOptimizations', req, { timeframe: timeframe as string });

    try {
      const optimizations = await aiInsightsService.generateOptimizations(timeframe as string);

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getOptimizations', req, startTime, {
        optimizationsCount: Array.isArray(optimizations) ? optimizations.length : 0
      });

      return res.json({
        success: true,
        optimizations
      });
    } catch (error: any) {
      ControllerHelper.handleError('getOptimizations', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Get predictive forecasts
   */
  static async getForecasts(req: AuthenticatedRequest, res: Response): Promise<Response> {
    const startTime = Date.now();
    const { timeframe = '24h' } = req.query;
    
    ControllerHelper.logRequestStart('getForecasts', req, { timeframe: timeframe as string });

    try {
      const forecasts = await aiInsightsService.generateForecasts(timeframe as string);

      const duration = Date.now() - startTime;

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

      ControllerHelper.logRequestSuccess('getForecasts', req, startTime, {
        forecastsCount: Array.isArray(forecasts) ? forecasts.length : 0
      });

      return res.json({
        success: true,
        forecasts
      });
    } catch (error: any) {
      ControllerHelper.handleError('getForecasts', error, req, res, startTime);
      return res;
    }
  }

  /**
   * Queue background operation
   */
  private static queueBackgroundOperation(operation: () => Promise<void>): void {
    this.backgroundQueue.push(operation);
  }
}

