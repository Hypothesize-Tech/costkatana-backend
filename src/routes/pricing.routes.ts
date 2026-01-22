import { Router } from 'express';
import { PricingController } from '../controllers/pricing.controller';
import { PricingRealtimeController } from '../controllers/pricingRealtime.controller';
import { PricingComparisonController } from '../controllers/pricingComparison.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// ============================================================
// Public endpoints (no authentication required)
// ============================================================

// Real-time pricing endpoints
// Polling endpoint for pricing updates
router.get('/updates', PricingRealtimeController.getPricingUpdates);

// Get all pricing data (public for basic pricing information)
router.get('/all', PricingRealtimeController.getAllPricing);

// Get pricing for specific provider (public)
router.get('/provider/:provider', PricingRealtimeController.getProviderPricing);

// Compare pricing across providers (public)
router.post('/compare', PricingRealtimeController.comparePricing);

// Comparison endpoints
// Get comparison table data (public) - must come before /models to avoid route conflict
router.get('/models/comparison-table', PricingComparisonController.getComparisonTable);

// Get all available models for comparison (public)
router.get('/models', PricingComparisonController.getAvailableModels);

// Compare two specific models (public)
router.post('/models/compare', PricingComparisonController.compareModels);

// Core pricing tool endpoints
// Cost Calculator Tool (public)
router.post('/tools/cost-calculator', PricingController.calculateCosts);

// Performance Benchmark Tool (public)
router.post('/tools/performance-benchmark', PricingComparisonController.runPerformanceBenchmark);

// Token Analyzer Tool (public)
router.post('/tools/token-analyzer', PricingController.analyzeTokens);

// Get cache status (public)
router.get('/cache-status', PricingRealtimeController.getCacheStatus);

// ============================================================
// Protected endpoints (authentication required)
// ============================================================
router.use(authenticate);

// Clear pricing cache (admin only)
router.delete('/cache', PricingRealtimeController.clearCache);

// Force update all pricing data (admin only)
router.post('/update', PricingRealtimeController.forceUpdate);

// Initialize pricing service (admin only)
router.post('/initialize', PricingController.initialize);

// Test web scraping for a specific provider (admin only)
router.get('/test-scraping/:provider', PricingController.testScraping);

// Trigger web scraping for providers (admin only)
router.post('/scrape', PricingController.triggerScraping);

export { router as pricingRoutes };
