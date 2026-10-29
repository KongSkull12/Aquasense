/**
 * Device Authentication Middleware - Validates x-device-key for ESP32 requests
 */
import { Request, Response, NextFunction } from 'express';
import { timingSafeEqual } from 'crypto';
import { config } from '../config/config';
import { sendError } from '../utils/response';
import { logger } from '../utils/logger';
import { deviceService } from '../services/device.service';
import { auditLogService } from '../services/auditLog.service';

export interface DeviceAuthenticatedRequest extends Request {
  deviceId?: string;
  deviceOwnerUserId?: string;
}

const safeEquals = (actual: string, expected: string): boolean => {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);

  if (actualBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(actualBuffer, expectedBuffer);
};

export const authenticateDevice = (req: DeviceAuthenticatedRequest, res: Response, next: NextFunction): void => {
  const deviceKeyHeader = req.headers['x-device-key'];
  const deviceKey = Array.isArray(deviceKeyHeader) ? deviceKeyHeader[0] : deviceKeyHeader;
  const deviceId = (req.body?.deviceId as string | undefined) || 'unknown-device';

  if (Object.keys(config.device.keys).length === 0 && config.server.nodeEnv !== 'production' && config.device.allowUnauthenticatedDevelopment) {
    logger.warn('Device auth bypassed: DEVICE_KEYS not configured', { deviceId });
    req.deviceId = deviceId;
    next();
    return;
  }

  if (!deviceKey && config.server.nodeEnv !== 'production' && config.device.allowUnauthenticatedDevelopment) {
    logger.warn('Device auth bypassed in development: missing x-device-key', { deviceId });
    req.deviceId = deviceId;
    next();
    return;
  }

  if (!deviceKey) {
    logger.warn('Device auth failed: missing x-device-key', { deviceId });
    void auditLogService.createLog({ deviceId, action: 'DEVICE_AUTH', status: 'FAILURE', ipAddress: req.ip, metadata: { reason: 'missing_key' } });
    sendError(res, 401, 'Unauthorized device');
    return;
  }

  const expectedKey = config.device.keys[deviceId];
  if (!expectedKey || !safeEquals(deviceKey, expectedKey)) {
    logger.warn('Device auth failed: invalid key', { deviceId });
    void auditLogService.createLog({ deviceId, action: 'DEVICE_AUTH', status: 'FAILURE', ipAddress: req.ip, metadata: { reason: 'invalid_key' } });
    sendError(res, 401, 'Unauthorized device');
    return;
  }

  void (async () => {
    const activeDevice = await deviceService.getActiveDevice(deviceId);
    if (!activeDevice) {
      logger.warn('Device auth failed: device not registered/active', { deviceId });
      await auditLogService.createLog({ deviceId, action: 'DEVICE_AUTH', status: 'FAILURE', ipAddress: req.ip, metadata: { reason: 'inactive_or_unregistered' } });
      sendError(res, 403, 'Device is not registered or inactive');
      return;
    }

    await auditLogService.createLog({ userId: activeDevice.userId, deviceId, action: 'DEVICE_AUTH', status: 'SUCCESS', ipAddress: req.ip });
    req.deviceId = deviceId;
    req.deviceOwnerUserId = activeDevice.userId;
    next();
  })().catch((error) => {
    logger.error('Device auth middleware error', error);
    sendError(res, 500, 'Device authentication failed');
  });
};

export default authenticateDevice;
