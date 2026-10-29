import express, { Express, Request, Response } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { createServer as createHTTPServer } from 'http';
import { config } from './config/config';
import { logger } from './utils/logger';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { requireHttps } from './middleware/requireHttps';
import { csrfProtection } from './middleware/csrfProtection';
import apiRoutes from './api';
import { ApiResponse } from './types';
import { WaterQualityWebSocketServer } from './websocket/waterQualityWS';
import { initializeDatabase, closeDatabase, syncDatabase } from './database/connection';
import { runMigrations } from './database/migrations';
import { initializeAllModels } from './database/models';
import { mqttService, sanitizeBrokerUrl } from './services/mqttService';
import { smsLogService } from './services/smsLogService';
import { waterQualityService } from './iot/water/services/waterQualityService';

/**
 * Initialize Express application
 */
const createApp = (): Express => {
  const app = express();

  // Trust proxy - important for production deployments
  app.set('trust proxy', 1);

  // Security middleware
  app.use(helmet()); // Set various HTTP headers for security
  app.use(requireHttps);
  app.use(cors(config.cors)); // Enable CORS with configured origins

  // Body parsing middleware
  app.use(express.json({ limit: '10kb' })); // Limit payload size to prevent large requests
  app.use(express.urlencoded({ limit: '10kb', extended: true }));
  app.use(csrfProtection);

  // Request logging
  app.use(
    morgan(':method :url :status :response-time ms', {
      stream: {
        write: (message: string) => logger.info(message.trim()),
      },
    })
  );

  const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  });
  app.use('/api', apiLimiter);

  // Health check endpoint
  app.get('/health', (_req: Request, res: Response) => {
    const mqttStatus = mqttService.getStatus();
    const response: ApiResponse = {
      success: true,
      statusCode: 200,
      message: 'Server is healthy',
      data: {
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        mqtt: {
          connected: mqttStatus.connected,
          lastPublicFrameReceivedAt: mqttStatus.lastPublicFrameReceivedAt,
          lastPublicFrameVerifiedAt: mqttStatus.lastPublicFrameVerifiedAt,
          lastPublicFramePersistedAt: mqttStatus.lastPublicFramePersistedAt,
        },
      },
    };
    res.json(response);
  });

  // API routes
  app.use('/api', apiRoutes);

  // Root endpoint
  app.get('/', (_req: Request, res: Response) => {
    const response: ApiResponse = {
      success: true,
      statusCode: 200,
      message: 'Welcome to Capstone Backend API - Water Quality IoT System',
      data: {
        version: config.api.version,
        environment: config.server.nodeEnv,
        mode: 'PREPARATION - Ready for ESP32 Integration',
      },
    };
    res.json(response);
  });

  // ESP32 Integration Guide
  app.get('/integration-guide', (_req: Request, res: Response) => {
    const baseUrl = `http://${config.server.host}:${config.server.port}`;
    const guide: ApiResponse = {
      success: true,
      statusCode: 200,
      message: 'ESP32 Integration Guide',
      data: {
        description: 'Backend is in PREPARATION mode - ready to receive real sensor data from ESP32',
        howtostartPosting: {
          endpoint: `POST ${baseUrl}/api/v1/sensors/data`,
          headers: {
            'Content-Type': 'application/json',
          },
          requestBody: {
            temperature: 25.5,
            ph: 7.4,
            do: 7.8,
            turbidity: 25.3,
            location: 'Sensor Location Name',
            deviceId: 'registered-device-id',
            timestamp: '2026-04-12T05:31:28.462Z',
          },
          example_curl: `curl -X POST ${baseUrl}/api/v1/sensors/data -H "Content-Type: application/json" -H "X-Device-Key: <configured-device-key>" -d '{"deviceId":"registered-device-id","temperature":25.5,"ph":7.4,"do":7.8,"turbidity":25.3,"location":"Main Tank","timestamp":"2026-04-12T05:31:28.462Z"}'`,
          esp32_pseudocode: `
            // Every 5 seconds (adjust as needed):
            POST /api/v1/sensors/data with:
            {
              "temperature": read_temp_sensor(),
              "ph": read_ph_sensor(),
              "do": read_do_sensor(),
              "turbidity": read_turbidity_sensor(),
              "location": "Water Tank 1",
              "deviceId": "registered-device-id",
              "timestamp": current_time()
            }
          `,
        },
        availableEndpoints: [
          'POST /api/v1/sensors/data - Add sensor reading',
          'GET /api/v1/water/readings/latest - Get latest reading',
          'GET /api/v1/water/readings?minutes=60 - Get readings by time range',
          'GET /api/v1/water/statistics?minutes=60 - Get statistics',
          'GET /api/v1/water/alerts?limit=50 - Get alerts',
          'GET /api/v1/water/thresholds - Get alert thresholds',
          'PUT /api/v1/water/thresholds - Update thresholds',
          'GET /api/v1/water/dashboard - Get combined dashboard data',
        ],
        websocketEvents: [
          'water:latest - Latest sensor reading',
          'water:stats - Statistics update',
          'water:alert - New alert triggered',
          'water:new-reading - New reading received',
        ],
        notes: 'Backend will remain stable without data. Data will be received and broadcast when ESP32 starts posting.',
      },
    };
    res.json(guide);
  });

  // 404 handler
  app.use(notFoundHandler);

  // Global error handler (must be last)
  app.use(errorHandler);

  return app;
};

/**
 * Start server
 */
const startServer = async (): Promise<void> => {
  let server: any;
  try {
    // Initialize database and models
    logger.info('Initializing database connection...');
    await initializeDatabase();
    logger.info('Applying database migrations...');
    await runMigrations();
    logger.info('Initializing database models...');
    await initializeAllModels();
    logger.info('Synchronizing database schema...');
    await syncDatabase();
    await waterQualityService.loadThresholds();
    const refreshSmsStatus = (): void => {
      void smsLogService.reconcilePending().catch(() => logger.warn('Unable to refresh pending SMS status'));
    };
    refreshSmsStatus();
    setInterval(refreshSmsStatus, 30000).unref();

    const app = createApp();
    if (!config.sms.apiSecretKey || !config.sms.senderId) {
      logger.warn('SMS integration unavailable: configure UNISMS_API_SECRET_KEY and UNISMS_SENDER_ID to enable SMS delivery');
    }
    const PORT = config.server.port;
    const HOST = config.server.host;

    // Create HTTP server
    const httpServer = createHTTPServer(app);

    // Initialize WebSocket server
    const wsServer = new WaterQualityWebSocketServer(httpServer);

    // Bridge MQTT readings to connected WebSocket dashboard clients
    mqttService.setRealtimeHandlers({
      onReadingReceived: (reading) => wsServer.broadcastReading(reading),
      onStatsUpdated: (stats) => wsServer.broadcastStats(stats),
    });

    // Initialize MQTT Service (Optional - for ESP32 integration via MQTT)
    try {
      logger.info('Initializing MQTT Service...');
      await mqttService.connect();
      const mqttStatus = mqttService.getStatus();
      logger.info(`✓ MQTT Service initialized - Broker: ${sanitizeBrokerUrl(mqttStatus.brokerUrl)}`);
    } catch {
      logger.warn('MQTT Service initialization skipped or failed - Proceeding without MQTT');
      // Continue without MQTT - REST API is still available
    }

    const startListening = (): void => {
      server = httpServer.listen(PORT, HOST, () => {
        const baseUrl = `http://${HOST}:${PORT}`;
        logger.info(`✓ Server is running on ${baseUrl}`);
        logger.info(`✓ Environment: ${config.server.nodeEnv}`);
        logger.info(`✓ API Version: ${config.api.version}`);
        logger.info(`✓ Database: ${config.database.name}`);
        logger.info(`✓ CORS Origins: ${config.cors.origin.join(', ')}`);
        logger.info(`✓ WebSocket server enabled at ws://${HOST}:${PORT}`);
        logger.info('');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('  PREPARATION MODE - Ready for ESP32 Integration');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('✓ Backend is connected to PostgreSQL database');
        logger.info('✓ Waiting for sensor data from ESP32');
        logger.info(`✓ Visit ${baseUrl}/integration-guide for ESP32 setup`);
        logger.info('✓ Frontend: http://localhost:3000');
        logger.info('═══════════════════════════════════════════════════════════════');
        logger.info('');
      });
    };

    httpServer.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${PORT} is already in use. Stop the existing process or change PORT in Backend/.env.`);
        process.exit(1);
      }

      logger.error('Failed to start HTTP server', {
        message: error.message,
        code: error.code,
      });
      process.exit(1);
    });

    // Start server
    startListening();

    // Add WebSocket server stats endpoint
    app.get('/stats', (_req: Request, res: Response) => {
      const response: ApiResponse = {
        success: true,
        statusCode: 200,
        message: 'Server statistics',
        data: {
          connectedClients: wsServer.getConnectedClientsCount(),
          timestamp: new Date().toISOString(),
        },
      };
      res.json(response);
    });

    // Graceful shutdown
    const shutdown = async (signal: string): Promise<void> => {
      logger.warn(`${signal} received - Starting graceful shutdown...`);
      if (server) {
        server.close(async () => {
          logger.info('HTTP server closed');
          
          // Close MQTT connection
          try {
            await mqttService.disconnect();
          } catch (error) {
            logger.warn('MQTT disconnect failed or already disconnected');
          }

          await closeDatabase();
          logger.info('Database connection closed');
          process.exit(0);
        });
      }

      // Force shutdown after 15 seconds
      setTimeout(() => {
        logger.error('Forced shutdown - timeout exceeded');
        process.exit(1);
      }, 15000);
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));

    // Handle uncaught exceptions - log but don't crash
    process.on('uncaughtException', (err: Error) => {
      logger.error('Uncaught Exception detected', {
        message: err.message,
        stack: err.stack,
        timestamp: new Date().toISOString(),
      });
      // Log the error but keep server running
      // Only exit if it's a critical startup error
      if (err.message.includes('EADDRINUSE') || err.message.includes('database')) {
        logger.error('Critical error - shutting down');
        process.exit(1);
      }
    });

    // Handle unhandled promise rejections - log but don't crash
    process.on('unhandledRejection', (reason: unknown) => {
      logger.error('Unhandled Promise Rejection detected', {
        reason: reason instanceof Error ? reason.message : String(reason),
        timestamp: new Date().toISOString(),
      });
      // Log the error but keep server running unless it's critical
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    if (server) {
      server.close();
    }
    await closeDatabase();
    process.exit(1);
  }
};

// Start the server
startServer();
