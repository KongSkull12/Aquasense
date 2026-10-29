import { Router } from 'express';
import v1Routes from './v1/routes';

const router = Router();

/**
 * Main API router
 * Routes all API versions
 */

// API v1
router.use('/v1', v1Routes);

// Future API versions can be added here:
// router.use('/v2', v2Routes);
// router.use('/v3', v3Routes);

export default router;
