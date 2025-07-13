import { Router } from 'express';
import { PricingController } from '../controllers/pricing.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Public endpoints (no authentication required)
// Polling endpoint for pricing updates
router.get('/updates', PricingController.getPricingUpdates);

// Get all pricing data (public for basic pricing information)
router.get('/all', PricingController.getAllPricing);

// Get pricing for specific provider (public)
router.get('/provider/:provider', PricingController.getProviderPricing);

// Compare pricing across providers (public)
router.post('/compare', PricingController.comparePricing);

// Get cache status (public)
router.get('/cache-status', PricingController.getCacheStatus);

// Protected endpoints (authentication required)
router.use(authenticate);

// Force update all pricing data (admin only)
router.post('/update', PricingController.forceUpdate);

// Initialize pricing service (admin only)
router.post('/initialize', PricingController.initialize);

// Test web scraping for a specific provider (admin only)
router.get('/test-scraping/:provider', PricingController.testScraping);

// Trigger web scraping for providers (admin only)
router.post('/scrape', PricingController.triggerScraping);

// Get scraping status (admin only)
router.get('/scrape/status', PricingController.getScrapingStatus);

export { router as pricingRoutes }; 