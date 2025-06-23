import { Router } from 'express';
import authRoutes from './auth.routes';
import usageRoutes from './usage.routes';
import analyticsRoutes from './analytics.routes';
import optimizationRoutes from './optimization.routes';
import userRoutes from './user.routes';

const router = Router();

// Health check
router.get('/health', (_, res) => {
    res.status(200).json({ status: 'ok' });
});

// API version
router.get('/version', (_, res) => {
    res.status(200).json({ version: process.env.npm_package_version });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/usage', usageRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/optimizations', optimizationRoutes);
router.use('/users', userRoutes);

export default router;