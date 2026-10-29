/**
 * Sensor ingestion controller - receives ESP32 payloads
 */
import { Response } from 'express';
import { sendError, sendSuccess } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import { sensorReadingService } from '../../../services/sensorReadingService';
import type { DeviceAuthenticatedRequest } from '../../../middleware/deviceAuthMiddleware';
import { waterAlertNotificationService } from '../../../services/waterAlertNotification.service';

/**
 * POST /api/v1/sensors/data
 */
export const ingestSensorData = async (req: DeviceAuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const payload = req.body;
    const deviceId = payload.deviceId;

    if (!deviceId) {
      sendError(res, 400, 'Missing required field: deviceId');
      return;
    }

    const reading = await sensorReadingService.ingest(deviceId, payload);
    const notificationResult = await waterAlertNotificationService.processReading({ ...reading, dissolvedOxygen: reading.do, dissolvedOxygenMeasured: reading.doMeasured });

    logger.info('[ESP32] Sensor payload processed', {
      deviceId,
      alertsCreated: notificationResult.alertsCreated,
      smsSent: notificationResult.smsSentCount,
    });

    sendSuccess(res, 200, 'Sensor data processed', {
      alertsCreated: notificationResult.alertsCreated,
    });
  } catch (error) {
    logger.error('Failed to ingest sensor data', error);
    sendError(res, 500, 'Failed to process sensor data');
  }
};
