/**
 * Sensor ingestion routes
 */
import { Router } from 'express';
import { ingestSensorData } from '../controllers/sensorsController';
import { authenticateDevice } from '../../../middleware/deviceAuthMiddleware';
import { validateBody, sensorIngestSchema } from '../../../middleware/validate';

const router = Router();

router.post('/sensors/data', authenticateDevice, validateBody(sensorIngestSchema), ingestSensorData);

export default router;
