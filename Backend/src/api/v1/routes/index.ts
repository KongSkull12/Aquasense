import { Router } from 'express';
import healthRoutes from './health';
import authRoutes from './auth';
import waterQualityRoutes from '../../../iot/water/routes';
import sensorRoutes from './sensors';
import alertRoutes from './alerts';
import smsRoutes from './sms';
import feedingRoutes from './feeding';
import deviceRoutes from './devices';
import hardwareRoutes from './hardware';

const router = Router();

/**
 * API v1 routes
 * All routes are prefixed with /api/v1
 */

// Health check routes
router.use(healthRoutes);

// Authentication routes
router.use('/auth', authRoutes);

// Water Quality IoT routes
router.use('/water', waterQualityRoutes);

// ESP32 sensor ingestion
router.use(sensorRoutes);

// Alert management
router.use(alertRoutes);

// SMS routes
router.use(smsRoutes);

// Feeding system routes
router.use(feedingRoutes);

// Device management routes
router.use(deviceRoutes);
router.use(hardwareRoutes);

// Add more route modules here as needed:
// router.use(userRoutes);
// router.use(productRoutes);

export default router;
