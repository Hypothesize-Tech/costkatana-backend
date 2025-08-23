import { Request, Response } from 'express';
import { notebookService } from '../services/notebook.service';
import { aiInsightsService } from '../services/aiInsights.service';
import { logger } from '../utils/logger';

export class NotebookController {
  /**
   * Get all notebooks
   */
  static async getNotebooks(_req: Request, res: Response): Promise<Response> {
    try {
      const notebooks = await notebookService.getNotebooks();
      return res.json({
        success: true,
        notebooks
      });
    } catch (error) {
      logger.error('Failed to get notebooks:', error);
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
    try {
      const { id } = req.params;
      const notebook = await notebookService.getNotebook(id);
      
      if (!notebook) {
        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      return res.json({
        success: true,
        notebook
      });
    } catch (error) {
      logger.error('Failed to get notebook:', error);
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
    try {
      const { title, description, template_type } = req.body;

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

      return res.status(201).json({
        success: true,
        notebook
      });
    } catch (error) {
      logger.error('Failed to create notebook:', error);
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
    try {
      const { id } = req.params;
      const updates = req.body;

      const notebook = await notebookService.updateNotebook(id, updates);
      
      if (!notebook) {
        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      return res.json({
        success: true,
        notebook
      });
    } catch (error) {
      logger.error('Failed to update notebook:', error);
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
    try {
      const { id } = req.params;
      const deleted = await notebookService.deleteNotebook(id);
      
      if (!deleted) {
        return res.status(404).json({
          success: false,
          error: 'Notebook not found'
        });
      }

      return res.json({
        success: true,
        message: 'Notebook deleted successfully'
      });
    } catch (error) {
      logger.error('Failed to delete notebook:', error);
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
    try {
      const { id } = req.params;
      const execution = await notebookService.executeNotebook(id);

      return res.json({
        success: true,
        execution
      });
    } catch (error) {
      logger.error('Failed to execute notebook:', error);
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
    try {
      const { executionId } = req.params;
      const execution = await notebookService.getExecution(executionId);
      
      if (!execution) {
        return res.status(404).json({
          success: false,
          error: 'Execution not found'
        });
      }

      return res.json({
        success: true,
        execution
      });
    } catch (error) {
      logger.error('Failed to get execution:', error);
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

      return res.json({
        success: true,
        templates
      });
    } catch (error) {
      logger.error('Failed to get templates:', error);
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
    try {
      const { timeframe = '24h' } = req.query;
      const insights = await aiInsightsService.generateInsights(timeframe as string);

      return res.json({
        success: true,
        insights
      });
    } catch (error) {
      logger.error('Failed to get AI insights:', error);
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
    try {
      const { timeframe = '24h' } = req.query;
      const anomalies = await aiInsightsService.detectAnomalies(timeframe as string);

      return res.json({
        success: true,
        anomalies
      });
    } catch (error) {
      logger.error('Failed to detect anomalies:', error);
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
    try {
      const { timeframe = '24h' } = req.query;
      const optimizations = await aiInsightsService.generateOptimizations(timeframe as string);

      return res.json({
        success: true,
        optimizations
      });
    } catch (error) {
      logger.error('Failed to get optimizations:', error);
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
    try {
      const { timeframe = '24h' } = req.query;
      const forecasts = await aiInsightsService.generateForecasts(timeframe as string);

      return res.json({
        success: true,
        forecasts
      });
    } catch (error) {
      logger.error('Failed to get forecasts:', error);
      return res.status(500).json({
        success: false,
        error: 'Failed to generate forecasts'
      });
    }
  }
}

