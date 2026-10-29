import { Response } from 'express';
import { sendError, sendSuccess } from '../../../utils/response';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { deviceService } from '../../../services/device.service';
import { logger } from '../../../utils/logger';
import { auditLogService } from '../../../services/auditLog.service';

export const listDevices = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      sendError(res, 401, 'Unauthorized');
      return;
    }
    const devices = await deviceService.listByUser(req.userId);
    sendSuccess(res, 200, 'Devices retrieved', devices);
  } catch (error) {
    logger.error('Failed to list devices', error);
    sendError(res, 500, 'Failed to list devices');
  }
};

export const registerDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      sendError(res, 401, 'Unauthorized');
      return;
    }
    const { deviceId, name } = req.body as { deviceId: string; name?: string };
    const device = await deviceService.registerDevice(req.userId, deviceId, name);
    await auditLogService.createLog({
      userId: req.userId,
      deviceId,
      action: 'DEVICE_REGISTER',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { name },
    });
    sendSuccess(res, 201, 'Device registered', device);
  } catch (error) {
    logger.error('Failed to register device', error);
    sendError(res, 400, error instanceof Error ? error.message : 'Failed to register device');
  }
};

export const deactivateDevice = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      sendError(res, 401, 'Unauthorized');
      return;
    }
    const { deviceId } = req.params;
    const deactivated = await deviceService.deactivateDevice(req.userId, deviceId);
    if (!deactivated) {
      sendError(res, 404, 'Device not found or already inactive');
      return;
    }
    await auditLogService.createLog({
      userId: req.userId,
      deviceId,
      action: 'DEVICE_DEACTIVATE',
      status: 'SUCCESS',
      ipAddress: req.ip,
    });
    sendSuccess(res, 200, 'Device deactivated');
  } catch (error) {
    logger.error('Failed to deactivate device', error);
    sendError(res, 500, 'Failed to deactivate device');
  }
};
