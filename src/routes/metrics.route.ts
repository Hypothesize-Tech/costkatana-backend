import { Router } from 'express';
import { getCacheMetrics } from '../controllers/metrics.controller';

const router = Router();

router.get('/cache', getCacheMetrics);

export default router;
