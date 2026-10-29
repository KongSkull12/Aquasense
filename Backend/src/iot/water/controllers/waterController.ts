/**
 * Water Quality Controllers
 * API endpoints for water quality monitoring
 */
import { Request, Response } from 'express';
import { waterQualityService } from '../services/waterQualityService';
import type { WaterQualityStats } from '../types';
import { sendSuccess, sendError } from '../../../utils/response';
import { logger } from '../../../utils/logger';
import { config } from '../../../config/config';
import { sensorReadingService } from '../../../services/sensorReadingService';
import { predictiveAnalyticsService } from '../../../services/predictiveAnalytics.service';
import { predictionLogService } from '../../../services/predictionLog.service';
import { smsLogService } from '../../../services/smsLogService';
import { alertService } from '../../../services/alert.service';
import { waterAlertNotificationService } from '../../../services/waterAlertNotification.service';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { deviceService } from '../../../services/device.service';
import { TanMeasurementInputError, tanMeasurementService } from '../../../services/tanMeasurement.service';
import { auditLogService } from '../../../services/auditLog.service';

const getReadingDeviceScope = async (req: AuthenticatedRequest): Promise<string[] | undefined> => {
  // An absent identity must never fall through to the service's unfiltered query.
  if (!req.userId) return [];
  if (req.userRole === 'admin') return undefined;
  return (await deviceService.listByUser(req.userId))
    .filter((device) => device.isActive)
    .map((device) => device.deviceId);
};

const mapDbStatsToWaterStats = async (minutes: number, deviceIds?: string[]): Promise<WaterQualityStats> => {
  const dbStats = await sensorReadingService.getStatistics(minutes, deviceIds);

  return {
    timestamp: new Date(),
    orp: dbStats.orp,
    temperature: {
      current: dbStats.temperature.current,
      average: dbStats.temperature.average,
      min: dbStats.temperature.min,
      max: dbStats.temperature.max,
    },
    ph: {
      current: dbStats.ph.current,
      average: dbStats.ph.average,
      min: dbStats.ph.min,
      max: dbStats.ph.max,
    },
    do: {
      current: dbStats.do.current,
      average: dbStats.do.average,
      min: dbStats.do.min,
      max: dbStats.do.max,
    },
    turbidity: {
      current: dbStats.turbidity.current,
      average: dbStats.turbidity.average,
      min: dbStats.turbidity.min,
      max: dbStats.turbidity.max,
    },
    ammonia: {
      current: dbStats.ammonia.current,
      average: dbStats.ammonia.average,
      min: dbStats.ammonia.min,
      max: dbStats.ammonia.max,
    },
    healthScore: dbStats.healthScore,
  };
};

type IngestMeta = {
  lastReceivedAt: string | null;
  lastSourceIp: string | null;
  lastLocation: string | null;
};

const ingestMeta: IngestMeta = {
  lastReceivedAt: null,
  lastSourceIp: null,
  lastLocation: null,
};

export const createTanMeasurement = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) { sendError(res, 401, 'Unauthorized'); return; }
    const { deviceId, value, source, sampleCollectedAt, validationEvidence } = req.body;
    const activeDevice = req.userRole === 'admin'
      ? await deviceService.getActiveDevice(deviceId)
      : await deviceService.verifyOwnership(req.userId, deviceId);
    if (!activeDevice) { sendError(res, 403, 'Device must be active and registered to the authenticated user'); return; }

    const measurement = await tanMeasurementService.record(req.userId, { deviceId, value, source, sampleCollectedAt, validationEvidence });
    await auditLogService.createLog({
      userId: req.userId,
      deviceId,
      action: 'TAN_MEASUREMENT_CREATE',
      status: 'SUCCESS',
      ipAddress: req.ip,
      metadata: { measurementId: measurement.id, source, sampleCollectedAt: measurement.sampleCollectedAt.toISOString() },
    });
    sendSuccess(res, 201, 'TAN measurement recorded', measurement);
  } catch (error) {
    logger.error('Failed to record TAN measurement', error);
    if (error instanceof TanMeasurementInputError) {
      sendError(res, 400, error.message);
      return;
    }
    sendError(res, 500, 'Failed to record TAN measurement');
  }
};

export const getTanMeasurements = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) { sendError(res, 401, 'Unauthorized'); return; }
    const requestedDevice = typeof req.query.deviceId === 'string' ? req.query.deviceId : undefined;
    let deviceIds: string[] | null = null;
    if (requestedDevice) {
      const allowed = req.userRole === 'admin'
        ? await deviceService.getActiveDevice(requestedDevice)
        : await deviceService.verifyOwnership(req.userId, requestedDevice);
      if (!allowed) { sendError(res, 403, 'Device must be active and available to the authenticated user'); return; }
      deviceIds = [requestedDevice];
    } else if (req.userRole !== 'admin') {
      deviceIds = (await deviceService.listByUser(req.userId)).filter((device) => device.isActive).map((device) => device.deviceId);
    }
    const limit = typeof req.query.limit === 'number' ? req.query.limit : Number(req.query.limit ?? 30);
    const measurements = await tanMeasurementService.list(deviceIds, limit);
    sendSuccess(res, 200, 'TAN measurements retrieved', measurements);
  } catch (error) {
    logger.error('Failed to retrieve TAN measurements', error);
    sendError(res, 500, 'Failed to retrieve TAN measurements');
  }
};

/**
 * Add new water quality reading
 * POST /api/v1/water/readings
 */
export const addReading = async (req: Request, res: Response): Promise<void> => {
  try {
    const deviceId = req.body.deviceId || 'unknown-device';
    const reading = await sensorReadingService.ingest(deviceId, req.body);
    ingestMeta.lastReceivedAt = new Date(reading.timestamp).toISOString();
    ingestMeta.lastSourceIp = req.ip || null;
    ingestMeta.lastLocation = reading.location || null;

    logger.info('[ESP32][HTTP] Reading received', {
      sourceIp: ingestMeta.lastSourceIp,
      temperature: reading.temperature,
      ph: reading.ph,
      do: reading.do,
      turbidity: reading.turbidity,
      ammonia: reading.ammonia,
      location: ingestMeta.lastLocation,
    });

    await waterAlertNotificationService.processReading({ ...reading, dissolvedOxygen: reading.do, dissolvedOxygenMeasured: reading.doMeasured }).catch(error=>logger.error('Post-ingestion notification failed', {deviceId, readingId:reading.id, error:String(error)}));

    sendSuccess(res, 201, 'Reading added successfully', reading);
  } catch (error) {
    sendError(res, 500, 'Failed to add reading', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getIngestStatus = (_req: Request, res: Response): void => {
  const baseUrl = `http://${config.server.host}:${config.server.port}`;
  sendSuccess(res, 200, 'Ingest status', {
    expectedPostUrl: `${baseUrl}/api/v1/water/readings`,
    lastReceivedAt: ingestMeta.lastReceivedAt,
    lastSourceIp: ingestMeta.lastSourceIp,
    lastLocation: ingestMeta.lastLocation,
  });
};

export const getLatestReading = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const deviceIds = await getReadingDeviceScope(req);
    const reading = await sensorReadingService.getLatestReading(deviceIds);
    if (!reading) {
      sendError(res, 404, 'No readings available yet');
      return;
    }
    sendSuccess(res, 200, 'Latest reading retrieved', reading);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch latest reading', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getReadingsByTimeRange = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const minutes = parseInt(req.query.minutes as string, 10) || 60;
    const deviceIds = await getReadingDeviceScope(req);
    const readings = await sensorReadingService.getReadingsByTimeRange(minutes, deviceIds);
    if (readings.length === 0) {
      sendError(res, 404, 'No readings found for the specified time range');
      return;
    }
    sendSuccess(res, 200, `${readings.length} readings retrieved`, readings);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch readings', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getStatistics = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const minutes = parseInt(req.query.minutes as string, 10) || 60;
    const deviceIds = await getReadingDeviceScope(req);
    const stats = await mapDbStatsToWaterStats(minutes, deviceIds);
    sendSuccess(res, 200, 'Statistics calculated', stats);
  } catch (error) {
    sendError(res, 500, 'Failed to calculate statistics', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getAlerts = (req: AuthenticatedRequest, res: Response): void => {
  void (async () => {
    try {
    const limit = parseInt(req.query.limit as string, 10) || 50;
    const deviceIds = req.userRole === 'admin' ? undefined : (req.userId ? (await deviceService.listByUser(req.userId)).filter((device) => device.isActive).map((device) => device.deviceId) : []);
    const alerts = await alertService.getAlerts(limit, undefined, deviceIds);
    sendSuccess(res, 200, 'Alerts retrieved', alerts);
    } catch (error) {
    sendError(res, 500, 'Failed to fetch alerts', error instanceof Error ? error.message : 'Unknown error');
    }
  })();
};

export const getThresholds = (_req: Request, res: Response): void => {
  try {
    const thresholds = waterQualityService.getThresholds();
    sendSuccess(res, 200, 'Thresholds retrieved', thresholds);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch thresholds', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const updateThresholds = async (req: Request, res: Response): Promise<void> => {
  try {
    const current = waterQualityService.getThresholds();
    const next = {
      ...current,
      ...req.body,
      temperature: { ...current.temperature, ...(req.body.temperature || {}) },
      ph: { ...current.ph, ...(req.body.ph || {}), optimal: { ...current.ph.optimal, ...(req.body.ph?.optimal || {}) } },
      do: { ...current.do, ...(req.body.do || {}) },
      turbidity: { ...current.turbidity, ...(req.body.turbidity || {}) },
    };
    await waterQualityService.setThresholds(next);
    const thresholds = waterQualityService.getThresholds();
    sendSuccess(res, 200, 'Thresholds updated', thresholds);
  } catch (error) {
    sendError(res, 500, 'Failed to update thresholds', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getDashboardData = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const deviceIds = await getReadingDeviceScope(req);
    const latest = await sensorReadingService.getLatestReading(deviceIds);
    const stats = await mapDbStatsToWaterStats(60, deviceIds);
    const alerts = await alertService.getAlerts(10, undefined, deviceIds);
    const thresholds = waterQualityService.getThresholds();
    const predictive = await predictiveAnalyticsService.getWarningCard(60);
    const predictionHistory = await predictionLogService.getRecentLogs(30, deviceIds);
    const smsLogs = await smsLogService.getRecentLogs(15, deviceIds);

    const dashboardData = {
      latest,
      stats,
      recentAlerts: alerts,
      thresholds,
      predictiveWarning: predictive,
      predictionHistory,
      smsLogs,
      timestamp: new Date(),
    };

    sendSuccess(res, 200, 'Dashboard data retrieved', dashboardData);
  } catch (error) {
    sendError(res, 500, 'Failed to fetch dashboard data', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getPredictiveWarning = async (req: Request, res: Response): Promise<void> => {
  try {
    const minutes = parseInt(req.query.minutes as string, 10) || 60;
    const predictiveWarning = await predictiveAnalyticsService.getWarningCard(minutes);
    sendSuccess(res, 200, 'Predictive warning generated', predictiveWarning);
  } catch (error) {
    sendError(res, 500, 'Failed to generate predictive warning', error instanceof Error ? error.message : 'Unknown error');
  }
};

export const getPredictionHistory = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    const limit = parseInt(req.query.limit as string, 10) || 60;
    const deviceIds = await getReadingDeviceScope(req);
    const logs = await predictionLogService.getRecentLogs(limit, deviceIds);
    sendSuccess(res, 200, 'Prediction history retrieved', logs);
  } catch (error) {
    sendError(res, 500, 'Failed to retrieve prediction history', error instanceof Error ? error.message : 'Unknown error');
  }
};
