import { Router } from 'express';
import {
  createSchedule,
  deleteSchedule,
  deviceAck,
  deviceSync,
  getFeedingState,
  getSchedules,
  triggerManualCommand,
  updateSchedule,
} from '../controllers/feedingController';
import { authenticateDevice } from '../../../middleware/deviceAuthMiddleware';
import { authenticateToken, requireRole } from '../../../middleware/authMiddleware';
import { validateBody, validateParams, feedingManualSchema, feedingScheduleSchema, feedingScheduleUpdateSchema, idParamSchema, feedingDeviceAckSchema, feedingDeviceSyncSchema } from '../../../middleware/validate';

const router = Router();

router.get('/feeding/schedules', authenticateToken, requireRole(['admin', 'farmer']), getSchedules);
router.post('/feeding/schedules', authenticateToken, requireRole(['admin', 'farmer']), validateBody(feedingScheduleSchema), createSchedule);
router.put('/feeding/schedules/:id', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), validateBody(feedingScheduleUpdateSchema), updateSchedule);
router.delete('/feeding/schedules/:id', authenticateToken, requireRole(['admin', 'farmer']), validateParams(idParamSchema), deleteSchedule);

router.post('/feeding/manual', authenticateToken, requireRole(['admin', 'farmer']), validateBody(feedingManualSchema), triggerManualCommand);
router.get('/feeding/state', authenticateToken, requireRole(['admin', 'farmer']), getFeedingState);

router.post('/feeding/device/sync', validateBody(feedingDeviceSyncSchema), authenticateDevice, deviceSync);
router.post('/feeding/device/ack', authenticateDevice, validateBody(feedingDeviceAckSchema), deviceAck);

export default router;
