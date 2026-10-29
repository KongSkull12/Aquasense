import { Router } from 'express';
import { config } from '../../../config/config';
import { authenticateToken, requireRole, type AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { authenticateDevice, type DeviceAuthenticatedRequest } from '../../../middleware/deviceAuthMiddleware';
import { validateBody } from '../../../middleware/validate';
import { hardwareCommandSchema, hardwareSyncSchema } from '../../../services/hardwareProtocol';
import { hardwareService } from '../../../services/hardwareService';
import { DeviceStopPendingError } from '../../../services/hardwareControlLock';
import { deviceService } from '../../../services/device.service';
import { auditLogService } from '../../../services/auditLog.service';
import { sendError, sendSuccess } from '../../../utils/response';
import { mqttService } from '../../../services/mqttService';

const router = Router();
router.post('/hardware/commands', authenticateToken, requireRole(['admin', 'farmer']), validateBody(hardwareCommandSchema),
  async (req: AuthenticatedRequest, res) => {
    if (config.mqtt.publicTelemetryOnly || !config.mqtt.actuatorCommandsEnabled) {
      sendError(res, 503, 'Generic hardware commands are disabled in public development mode'); return;
    }
    const { deviceId, action, durationMs } = req.body;
    try {
      if (!req.userId || !(await deviceService.verifyOwnership(req.userId, deviceId))) { sendError(res, 403, 'Device is not owned/active'); return; }
      const command = await hardwareService.queue(req.userId, deviceId, action, durationMs);
      const published = await mqttService.dispatchHardwareCommand({ id: command.id, deviceId, source: 'hardware', action,
        durationMs, expiresAt: command.expiresAt });
      await auditLogService.createLog({ userId: req.userId, deviceId, action: 'HARDWARE_COMMAND', status: 'SUCCESS',
        ipAddress: req.ip, metadata: { commandId: command.id, action, durationMs } });
      sendSuccess(res, 202, published ? 'Command queued; awaiting device acknowledgment' : 'Command queued; device acknowledgment pending',
        { id: command.id, commandId: command.id, action: command.action, status: command.status, result: command.result,
          expiresAt: command.expiresAt, published });
    } catch (error) {
      if (error instanceof DeviceStopPendingError) { sendError(res, 409, error.message); return; }
      sendError(res, 503, 'Unable to queue hardware command');
    }
  });
router.get('/hardware/state', authenticateToken, requireRole(['admin', 'farmer']), async (req: AuthenticatedRequest, res) => {
  const deviceId = typeof req.query.deviceId === 'string' ? req.query.deviceId : '';
  try {
    if (!req.userId || !(await deviceService.verifyOwnership(req.userId, deviceId))) { sendError(res, 403, 'Device is not owned/active'); return; }
    const state = await hardwareService.getState(req.userId, deviceId);
    const telemetryOnline = mqttService.isTelemetryDeviceOnline(deviceId);
    sendSuccess(res, 200, 'Last reported hardware state', {
      ...state,
      online: state.online || telemetryOnline,
      receivedAt: state.receivedAt || (telemetryOnline ? mqttService.getStatus().lastPublicFrameVerifiedAt : null),
    });
  } catch { sendError(res, 503, 'Unable to read hardware state'); }
});
router.post('/hardware/device/sync', validateBody(hardwareSyncSchema), (req, res, next) => {
  // Actuator endpoints never use the legacy middleware's development bypass.
  if (!req.headers['x-device-key'] || !config.device.keys[req.body.deviceId]) {
    sendError(res, 401, 'A configured device key is required'); return;
  }
  authenticateDevice(req, res, next);
}, async (req: DeviceAuthenticatedRequest, res) => {
  try {
    if (!req.deviceOwnerUserId || !req.deviceId) { sendError(res, 403, 'Device owner unavailable'); return; }
    const data = await hardwareService.sync(req.deviceOwnerUserId, req.deviceId, req.body.state, req.body.receipt);
    sendSuccess(res, 200, 'Hardware synchronized', data);
  } catch { sendError(res, 503, 'Hardware sync failed; retry the same receipt'); }
});
export default router;
