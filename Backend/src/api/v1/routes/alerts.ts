/**
 * Alert management routes
 */
import { Router } from 'express';
import {
  getAlerts,
  getAlertById,
  acknowledgeAlert,
  resolveAlert,
  resendAlert,
} from '../controllers/alertsController';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateParams, validateQuery, alertQuerySchema, idParamSchema } from '../../../middleware/validate';

const router = Router();

router.get('/alerts', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(alertQuerySchema), getAlerts);
router.get('/alerts/:id', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateParams(idParamSchema), getAlertById);
router.post('/alerts/:id/ack', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), acknowledgeAlert);
router.patch('/alerts/:id/resolve', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), resolveAlert);
router.post('/alerts/:id/resend', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), resendAlert);

export default router;
