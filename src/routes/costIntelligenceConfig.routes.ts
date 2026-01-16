/**
 * Cost Intelligence Configuration Routes
 * 
 * Endpoints for managing cost intelligence stack configuration
 */

import { Router, Request, Response } from 'express';
import { costIntelligenceConfig } from '../config/costIntelligence.config';
import { loggingService } from '../services/logging.service';

const router = Router();

/**
 * Get current configuration
 * GET /api/cost-intelligence-config
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const config = costIntelligenceConfig.getConfig();

    res.json({
      success: true,
      data: config
    });
  } catch (error) {
    loggingService.error('Failed to get cost intelligence config', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve configuration'
    });
  }
});

/**
 * Get specific layer configuration
 * GET /api/cost-intelligence-config/:layer
 */
router.get('/:layer', async (req: Request, res: Response) => {
  try {
    const layer = req.params.layer;
    const config = costIntelligenceConfig.getConfig();

    if (!(layer in config)) {
      return res.status(404).json({
        success: false,
        error: `Layer '${layer}' not found`
      });
    }

    return res.json({
      success: true,
      data: (config as any)[layer]
    });
  } catch (error) {
    loggingService.error('Failed to get layer config', {
      error: error instanceof Error ? error.message : String(error),
      layer: req.params.layer
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve layer configuration'
    });
  }
});

/**
 * Update configuration
 * PUT /api/cost-intelligence-config
 */
router.put('/', async (req: Request, res: Response) => {
  try {
    const updates = req.body;

    // Validate updates
    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration updates'
      });
    }

    costIntelligenceConfig.updateConfig(updates);

    // Validate the new configuration
    const validation = costIntelligenceConfig.validateConfig();
    if (!validation.valid) {
      // Rollback on validation failure
      costIntelligenceConfig.resetToDefaults();
      
      return res.status(400).json({
        success: false,
        error: 'Configuration validation failed',
        details: validation.errors
      });
    }

    return res.json({
      success: true,
      message: 'Configuration updated successfully',
      data: costIntelligenceConfig.getConfig()
    });
  } catch (error) {
    loggingService.error('Failed to update cost intelligence config', {
      error: error instanceof Error ? error.message : String(error)
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to update configuration'
    });
  }
});

/**
 * Update specific layer configuration
 * PUT /api/cost-intelligence-config/:layer
 */
router.put('/:layer', async (req: Request, res: Response) => {
  try {
    const layer = req.params.layer;
    const updates = req.body;
    const config = costIntelligenceConfig.getConfig();

    if (!(layer in config)) {
      return res.status(404).json({
        success: false,
        error: `Layer '${layer}' not found`
      });
    }

    if (!updates || typeof updates !== 'object') {
      return res.status(400).json({
        success: false,
        error: 'Invalid configuration updates'
      });
    }

    costIntelligenceConfig.updateLayerConfig(layer as any, updates);

    // Validate the new configuration
    const validation = costIntelligenceConfig.validateConfig();
    if (!validation.valid) {
      // Rollback on validation failure
      costIntelligenceConfig.resetToDefaults();
      
      return res.status(400).json({
        success: false,
        error: 'Configuration validation failed',
        details: validation.errors
      });
    }

    return res.json({
      success: true,
      message: `${layer} configuration updated successfully`,
      data: costIntelligenceConfig.getLayerConfig(layer as any)
    });
  } catch (error) {
    loggingService.error('Failed to update layer config', {
      error: error instanceof Error ? error.message : String(error),
      layer: req.params.layer
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to update layer configuration'
    });
  }
});

/**
 * Reset configuration to defaults
 * POST /api/cost-intelligence-config/reset
 */
router.post("/reset", async (_req: Request, res: Response) => {
  try {
    costIntelligenceConfig.resetToDefaults();

    res.json({
      success: true,
      message: 'Configuration reset to defaults',
      data: costIntelligenceConfig.getConfig()
    });
  } catch (error) {
    loggingService.error('Failed to reset cost intelligence config', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to reset configuration'
    });
  }
});

/**
 * Validate current configuration
 * GET /api/cost-intelligence-config/validate
 */
router.get("/actions/validate", async (_req: Request, res: Response) => {
  try {
    const validation = costIntelligenceConfig.validateConfig();

    res.json({
      success: true,
      data: validation
    });
  } catch (error) {
    loggingService.error('Failed to validate cost intelligence config', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to validate configuration'
    });
  }
});

/**
 * Export configuration
 * GET /api/cost-intelligence-config/export
 */
router.get("/actions/export", async (_req: Request, res: Response) => {
  try {
    const exportData = costIntelligenceConfig.exportConfig();

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', 'attachment; filename="cost-intelligence-config.json"');
    res.send(exportData);
  } catch (error) {
    loggingService.error('Failed to export cost intelligence config', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to export configuration'
    });
  }
});

/**
 * Get performance configuration
 * GET /api/cost-intelligence-config/performance
 */
router.get('/actions/performance', async (_req: Request, res: Response) => {
  try {
    const perfConfig = costIntelligenceConfig.getPerformanceConfig();

    res.json({
      success: true,
      data: perfConfig
    });
  } catch (error) {
    loggingService.error('Failed to get performance config', {
      error: error instanceof Error ? error.message : String(error)
    });
    res.status(500).json({
      success: false,
      error: 'Failed to retrieve performance configuration'
    });
  }
});

/**
 * Check if a feature is enabled
 * GET /api/cost-intelligence-config/feature/:layer/:feature?
 */
router.get('/feature/:layer/:feature?', async (req: Request, res: Response) => {
  try {
    const { layer, feature } = req.params;
    const config = costIntelligenceConfig.getConfig();

    if (!(layer in config)) {
      return res.status(404).json({
        success: false,
        error: `Layer '${layer}' not found`
      });
    }

    const enabled = costIntelligenceConfig.isFeatureEnabled(layer as any, feature);

    return res.json({
      success: true,
      data: {
        layer,
        feature: feature || 'all',
        enabled
      }
    });
  } catch (error) {
    loggingService.error('Failed to check feature status', {
      error: error instanceof Error ? error.message : String(error),
      layer: req.params.layer,
      feature: req.params.feature
    });
    return res.status(500).json({
      success: false,
      error: 'Failed to check feature status'
    });
  }
});

export default router;

