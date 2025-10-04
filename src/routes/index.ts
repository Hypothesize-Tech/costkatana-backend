import { Router } from 'express';
import metricsRouter from './metrics.route';
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
import performanceCostAnalysisRoutes from './performanceCostAnalysis.routes';
import experimentationRoutes from './experimentation.routes';
import chatRoutes from './chat.routes';
import agentRoutes from './agent.routes';
import { chatgptRoutes } from './chatgpt.routes';
import { cursorRoutes } from './cursor.routes';
import { apiKeyRoutes } from './apiKey.routes';
import { onboardingRoutes } from './onboarding.routes';
import { onboardingApiRoutes } from './onboarding-api.routes';
import { monitoringRoutes } from './monitoring.routes';
import { gatewayRoutes } from './gateway.routes';
import workflowRoutes from './workflow.routes';
import memoryRoutes from './memory.routes';
import keyVaultRoutes from './keyVault.routes';
import requestFeedbackRoutes from './requestFeedback.routes';
import simulationTrackingRoutes from './simulationTracking.routes';
import autoSimulationRoutes from './autoSimulation.routes';
import predictiveIntelligenceRoutes from './predictiveIntelligence.routes';
import cacheRoutes from './cache.routes';
import budgetRoutes from './budget.routes';
import trackingRoutes from './tracking.routes';
import traceRoutes from './trace.routes';
import telemetryRoutes from './telemetry.routes';
import ckqlRoutes from './ckql.routes';
import notebookRoutes from './notebook.routes';
import guardrailsRoutes from './guardrails.routes';
import webhookRoutes from './webhook.routes';
import mfaRoutes from './mfa.routes';
import moderationRoutes from './moderation.routes';
import { securityRoutes } from './security.routes';
import unexplainedCostRoutes from './unexplainedCost.routes';
import cortexTrainingDataRoutes from './cortexTrainingData.routes';
import backupRoutes from './backupRoutes';

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
router.use('/performance-cost', performanceCostAnalysisRoutes);
router.use('/experimentation', experimentationRoutes);
router.use('/chat', chatRoutes);
router.use('/agent', agentRoutes);
router.use('/chatgpt', chatgptRoutes);
router.use('/cursor', cursorRoutes);
router.use('/api-keys', apiKeyRoutes);
router.use('/onboarding', onboardingRoutes);
router.use('/onboarding', onboardingApiRoutes);
router.use('/monitoring', monitoringRoutes);
router.use('/gateway', gatewayRoutes);
router.use('/metrics', metricsRouter);
router.use('/workflows', workflowRoutes);
router.use('/memory', memoryRoutes);
router.use('/key-vault', keyVaultRoutes);
router.use('/v1', requestFeedbackRoutes);
router.use('/simulation-tracking', simulationTrackingRoutes);
router.use('/auto-simulation', autoSimulationRoutes);
router.use('/predictive-intelligence', predictiveIntelligenceRoutes);
router.use('/cache', cacheRoutes);
router.use('/budget', budgetRoutes);
router.use('/tracking', trackingRoutes);
router.use('/v1', traceRoutes);
router.use('/telemetry', telemetryRoutes);
router.use('/ckql', ckqlRoutes);
router.use('/notebooks', notebookRoutes);
router.use('/guardrails', guardrailsRoutes);
router.use('/webhooks', webhookRoutes);
router.use('/mfa', mfaRoutes);
router.use('/moderation', moderationRoutes);
router.use('/security', securityRoutes);
router.use('/unexplained-costs', unexplainedCostRoutes);
router.use('/cortex-training-data', cortexTrainingDataRoutes);
router.use('/backup', backupRoutes);

export const apiRouter = router;