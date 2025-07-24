import { Router } from 'express';
import { CursorController } from '../controllers/cursor.controller';
import { asyncHandler } from '../middleware/error.middleware';

const router = Router();

/**
 * Cursor Extension Integration Routes
 * These routes are designed for Cursor/VS Code extension actions
 */

// Health check
router.get('/health', asyncHandler(CursorController.healthCheck));

// Main action handler - handles all Cursor extension requests
router.post('/action', asyncHandler(CursorController.handleAction));

// Specific endpoints for different actions
router.post('/track-usage', asyncHandler(CursorController.handleAction));
router.post('/optimize-prompt', asyncHandler(CursorController.handleAction));
router.post('/get-suggestions', asyncHandler(CursorController.handleAction));
router.post('/analyze-code', asyncHandler(CursorController.handleAction));
router.post('/workspace-setup', asyncHandler(CursorController.handleAction));

// Project management
router.post('/projects', asyncHandler(CursorController.handleAction));
router.get('/projects', asyncHandler(CursorController.handleAction));

// Analytics
router.get('/analytics', asyncHandler(CursorController.handleAction));

// Magic link generation
router.post('/magic-link', asyncHandler(CursorController.handleAction));

export { router as cursorRoutes }; 