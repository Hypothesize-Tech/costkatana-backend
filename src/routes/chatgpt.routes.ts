import { Router } from 'express';
import { ChatGPTController } from '../controllers/chatgpt.controller';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

/**
 * ChatGPT Integration Routes
 * These routes are designed for Custom GPT actions
 */

// Health check
router.get('/health', asyncHandler(ChatGPTController.healthCheck));

// Main action handler - handles all ChatGPT Custom GPT requests
router.post('/action', asyncHandler(ChatGPTController.handleAction));

// Legacy endpoints for backward compatibility
router.post('/track', asyncHandler(ChatGPTController.handleAction));
router.post('/projects', asyncHandler(ChatGPTController.handleAction));
router.get('/projects', asyncHandler(ChatGPTController.handleAction));
router.get('/analytics', asyncHandler(ChatGPTController.handleAction));

export { router as chatgptRoutes }; 