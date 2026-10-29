/**
 * Water Quality Routes
 * API endpoints for water monitoring
 */
import { Router } from 'express';
import {
  addReading,
  getLatestReading,
  getReadingsByTimeRange,
  getStatistics,
  getAlerts,
  getThresholds,
  updateThresholds,
  getDashboardData,
  getIngestStatus,
  getPredictiveWarning,
  getPredictionHistory,
  createTanMeasurement,
  getTanMeasurements,
} from './controllers/waterController';
import { validateBody, validateQuery, waterReadingSchema, thresholdPatchSchema, timeRangeQuerySchema, limitQuerySchema, tanMeasurementEntrySchema, tanMeasurementQuerySchema } from '../../middleware/validate';
import { authenticateDevice } from '../../middleware/deviceAuthMiddleware';
import { authenticateToken, requireRole } from '../../middleware/authMiddleware';

const router = Router();

/**
 * Water Quality Monitoring Routes
 * Base path: /api/v1/water
 */

// Readings endpoints
router.post('/readings', validateBody(waterReadingSchema), authenticateDevice, addReading); // Add new reading
router.get('/readings/latest', authenticateToken, requireRole(['admin', 'farmer', 'guest']), getLatestReading); // Get latest
router.get('/readings', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(timeRangeQuerySchema), getReadingsByTimeRange); // Get by time range
router.post('/tan-measurements', authenticateToken, requireRole(['admin', 'farmer']), validateBody(tanMeasurementEntrySchema), createTanMeasurement);
router.get('/tan-measurements', authenticateToken, requireRole(['admin', 'farmer']), validateQuery(tanMeasurementQuerySchema), getTanMeasurements);
router.get('/ingest-status', authenticateToken, requireRole(['admin', 'farmer']), getIngestStatus); // ESP32 ingest status

// Statistics endpoint
router.get('/statistics', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(timeRangeQuerySchema), getStatistics); // Get statistics

// Alerts endpoint
router.get('/alerts', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(limitQuerySchema), getAlerts); // Get alerts

// Thresholds endpoints
router.get('/thresholds', authenticateToken, requireRole(['admin', 'farmer', 'guest']), getThresholds); // Get thresholds
router.put('/thresholds', authenticateToken, requireRole(['admin', 'farmer']), validateBody(thresholdPatchSchema), updateThresholds); // Update thresholds

// Dashboard endpoint (combined data)
router.get('/dashboard', authenticateToken, requireRole(['admin', 'farmer', 'guest']), getDashboardData); // Get all dashboard data
router.get('/predictive-warning', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(timeRangeQuerySchema), getPredictiveWarning); // Trend-based early warning card
router.get('/predictions', authenticateToken, requireRole(['admin', 'farmer', 'guest']), validateQuery(limitQuerySchema), getPredictionHistory); // Prediction history for evidence graph

export default router;
