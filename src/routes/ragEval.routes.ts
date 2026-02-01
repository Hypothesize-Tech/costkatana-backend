/**
 * RAG Evaluation Routes
 * Internal batch evaluation API (RAGAS-aligned metrics)
 */

import express from 'express';
import { authenticate, authorize } from '../middleware/auth.middleware';
import { evaluateBatch } from '../controllers/ragEval.controller';

const router = express.Router();

// All RAG eval routes require authentication and admin role
router.use(authenticate);
router.use(authorize('admin'));

// POST /evaluate - Run batch RAG evaluation on a dataset
router.post('/evaluate', evaluateBatch);

export default router;
