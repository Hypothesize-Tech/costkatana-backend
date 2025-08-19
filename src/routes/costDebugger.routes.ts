import { Router } from 'express';
import { CostDebuggerController } from '../controllers/costDebugger.controller';
import { authenticate } from '../middleware/auth.middleware';

const router = Router();

// Apply authentication middleware to all routes
router.use(authenticate);

// Analyze a single prompt
router.post('/analyze', CostDebuggerController.analyzePrompt);

// Detect dead weight in a prompt
router.post('/dead-weight', CostDebuggerController.detectDeadWeight);

// Compare two prompt versions
router.post('/compare', CostDebuggerController.comparePromptVersions);

// Get prompt insights and recommendations
router.get('/insights', CostDebuggerController.getPromptInsights);

// Compare prompt across multiple providers/models
router.post('/provider-comparison', CostDebuggerController.getProviderComparison);

export default router;
