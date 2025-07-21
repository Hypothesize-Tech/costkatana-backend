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
import { inferenceScalingRoutes } from './inferenceScaling.routes';
import experimentationRoutes from './experimentation.routes';
import chatRoutes from './chat.routes';

const router = Router();

// Health check
router.get('/health', (_, res) => {
    res.status(200).json({ status: 'AI Cost Optimizer Backend API' });
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
router.use('/inference-scaling', inferenceScalingRoutes);
router.use('/experimentation', experimentationRoutes);
router.use('/chat', chatRoutes);

export const apiRouter = router;