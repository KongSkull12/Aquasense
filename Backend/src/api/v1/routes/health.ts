import { Router } from 'express';
import { healthCheck } from '../controllers/healthController';

const router = Router();

/**
 * Health check endpoint
 * GET /api/v1/health
 */
router.get('/health', healthCheck);

export default router;
