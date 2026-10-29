import { Router } from 'express';
import { healthCheck } from '../controllers/healthController';

const router = Router();

/**
 * @deprecated
 * Legacy routes file. New API endpoints should be created in:
 * src/api/v1/routes/
 *
 * This file is kept for backwards compatibility.
 * All new routes should follow the versioned API structure:
 * src/api/v1/routes/[feature].ts
 * src/api/v1/controllers/[feature]Controller.ts
 */

/**
 * Health check endpoint (legacy)
 */
router.get('/health', healthCheck);

export default router;

