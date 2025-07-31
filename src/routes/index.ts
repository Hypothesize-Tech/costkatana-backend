import { Router } from 'express';
import authRouter from './auth.routes';
import userRouter from './user.routes';
import usageRouter from './usage.routes';
import optimizationRouter from './optimization.routes';
import analyticsRouter from './analytics.routes';
import { trackerRouter } from './tracker.routes';
import intelligenceRoutes from './intelligence.routes';
import projectRoutes from './project.routes';
import promptTemplateRoutes from './promptTemplate.routes';
import { pricingRoutes } from './pricing.routes';
import taggingRoutes from './tagging.routes';
import forecastingRoutes from './forecasting.routes';
import performanceCostAnalysisRoutes from './performanceCostAnalysis.routes';
import experimentationRoutes from './experimentation.routes';
import chatRoutes from './chat.routes';
import agentRoutes from './agent.routes';
import { chatgptRoutes } from './chatgpt.routes';
import { cursorRoutes } from './cursor.routes';
import { apiKeyRoutes } from './apiKey.routes';
import { onboardingRoutes } from './onboarding.routes';
import { monitoringRoutes } from './monitoring.routes';
import { gatewayRoutes } from './gateway.routes';
import workflowRoutes from './workflow.routes';
import keyVaultRoutes from './keyVault.routes';
import requestFeedbackRoutes from './requestFeedback.routes';
import trainingRoutes from './training.routes';

const router = Router();

// Health check
router.get('/health', (_, res) => {
    res.status(200).json({ status: 'Cost Katana Backend API' });
});

// API version
router.get('/version', (_, res) => {
    res.status(200).json({ version: process.env.npm_package_version });
});

// Mount routes
router.use('/auth', authRouter);
router.use('/user', userRouter);
router.use('/usage', usageRouter);
router.use('/optimizations', optimizationRouter);
router.use('/analytics', analyticsRouter);
router.use('/tracker', trackerRouter);
router.use('/intelligence', intelligenceRoutes);
router.use('/projects', projectRoutes);
router.use('/prompt-templates', promptTemplateRoutes);
router.use('/pricing', pricingRoutes);
router.use('/tags', taggingRoutes);
router.use('/forecasting', forecastingRoutes);
router.use('/performance-cost', performanceCostAnalysisRoutes);
router.use('/experimentation', experimentationRoutes);
router.use('/chat', chatRoutes);
router.use('/agent', agentRoutes);
router.use('/chatgpt', chatgptRoutes);
router.use('/cursor', cursorRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/gateway', gatewayRoutes);
router.use('/workflows', workflowRoutes);
router.use('/key-vault', keyVaultRoutes);
router.use('/v1', requestFeedbackRoutes);
router.use('/training', trainingRoutes);

export const apiRouter = router;