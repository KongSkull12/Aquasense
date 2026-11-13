/**
 * Alerts controller - manage alerts and SMS resend
 */
import { Response } from 'express';
import { sendError, sendSuccess } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import { alertService } from '../../../services/alert.service';
import { smsNotificationService } from '../../../services/smsNotification.service';
import { buildSmsTemplate } from '../../../services/smsTemplate.service';
import { config } from '../../../config/config';
import { alertPhonesForDevice } from '../../../services/smsRecipients';
import type { AlertStatus } from '../../../services/alert.service';
import type { AlertSeverity } from '../../../services/ruleEngine.service';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { accessibleDeviceIds } from '../../../services/deviceAccess';

const visibleDeviceIds = async (req: AuthenticatedRequest): Promise<string[] | undefined> => {
  if (!req.userId) return [];
  return accessibleDeviceIds(req.userId, req.userRole);
};

const parseLimit = (value: unknown): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 50;
  }
  return Math.min(parsed, 200);
};

export const getAlerts = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseLimit(req.query.limit);
    const status = req.query.status as AlertStatus | undefined;
    const alerts = await alertService.getAlerts(limit, status, await visibleDeviceIds(req));
    sendSuccess(res, 200, 'Alerts retrieved', alerts);
  } catch (error) {
    logger.error('Failed to fetch alerts', error);
    sendError(res, 500, 'Failed to fetch alerts');
  }
};

export const getAlertById = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const alert = await alertService.getAlertById(req.params.id, await visibleDeviceIds(req));
    if (!alert) {
      sendError(res, 404, 'Alert not found');
      return;
    }

    sendSuccess(res, 200, 'Alert retrieved', alert);
  } catch (error) {
    logger.error('Failed to fetch alert', error);
    sendError(res, 500, 'Failed to fetch alert');
  }
};

export const acknowledgeAlert = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const updated = await alertService.updateStatus(req.params.id, 'ACKNOWLEDGED', await visibleDeviceIds(req));
    if (!updated) {
      sendError(res, 404, 'Alert not found');
      return;
    }

    sendSuccess(res, 200, 'Alert acknowledged', updated);
  } catch (error) {
    logger.error('Failed to acknowledge alert', error);
    sendError(res, 500, 'Failed to acknowledge alert');
  }
};

export const resolveAlert = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const updated = await alertService.updateStatus(req.params.id, 'RESOLVED', await visibleDeviceIds(req));
    if (!updated) {
      sendError(res, 404, 'Alert not found');
      return;
    }

    sendSuccess(res, 200, 'Alert resolved', updated);
  } catch (error) {
    logger.error('Failed to resolve alert', error);
    sendError(res, 500, 'Failed to resolve alert');
  }
};

export const resendAlert = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const alert = await alertService.getAlertById(req.params.id, await visibleDeviceIds(req));
    if (!alert) {
      sendError(res, 404, 'Alert not found');
      return;
    }

    const recipients = await alertPhonesForDevice(alert.deviceId);
    if (!recipients.length) {
      sendError(res, 400, 'SMS alerts are off, or this account has no mobile numbers saved');
      return;
    }

    const tankName = config.farm.tankName || alert.deviceId;
    const smsMessage = buildSmsTemplate({
      farmerName: config.farm.farmerName,
      farmName: config.farm.farmName,
      tankName,
      severity: alert.severity as AlertSeverity,
      problem: alert.message,
      value: alert.currentValue,
      unit: alert.unit,
      action: alert.action,
    });

    const results = await smsNotificationService.sendEach({
      deviceId: alert.deviceId,
      category: alert.category || 'WATER_QUALITY_ALERT',
      severity: alert.severity as AlertSeverity,
      recipients, message: smsMessage, alertIds: [alert.id],
    });
    if (!results) {
      sendError(res, 409, 'A notification is already pending or cooling down');
      return;
    }
    const accepted = results.filter((result) => result.accepted);
    if (!accepted.length) {
      sendError(res, results.some((result) => result.status === 'rejected') ? 422 : 502, 'Alert SMS was not confirmed sent');
      return;
    }
    const allSent = accepted.every((result) => result.success);
    sendSuccess(res, allSent ? 200 : 202, allSent ? `Provider reports alert SMS sent to ${accepted.length} number${accepted.length === 1 ? '' : 's'}` : 'Alert SMS accepted; awaiting provider status', {
      accepted: accepted.length,
    });
  } catch (error) {
    logger.error('Failed to resend alert SMS', error);
    sendError(res, 500, 'Failed to resend alert');
  }
};
