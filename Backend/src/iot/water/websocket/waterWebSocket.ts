/**
 * Water Quality WebSocket Handler
 * Real-time data broadcasting using Socket.io
 */
import { Server as SocketIOServer, Socket } from 'socket.io';
import { logger } from '../../../utils/logger';
import { waterQualityService } from '../services/waterQualityService';

export class WaterQualityWebSocketHandler {
  private io: SocketIOServer;
  private connectedClients = new Set<string>();

  constructor(io: SocketIOServer) {
    this.io = io;
    this.setupEventHandlers();
    // Production streams never synthesize sensor measurements.
  }

  /**
   * Setup all WebSocket event handlers
   */
  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.connectedClients.add(socket.id);
      logger.info(`Water quality client connected: ${socket.id}`, {
        totalClients: this.connectedClients.size,
      });

      // Send latest reading on connection
      const latest = waterQualityService.getLatestReading();
      if (latest) {
        socket.emit('water:latest', latest);
      }

      // Send current statistics
      try {
        const stats = waterQualityService.getStatistics(60);
        socket.emit('water:stats', stats);
      } catch {
        logger.debug('No stats available yet');
      }

      // Handle client events
      socket.on('water:request-latest', () => {
        const latest = waterQualityService.getLatestReading();
        socket.emit('water:latest', latest);
      });

      socket.on('water:request-stats', (minutes: number) => {
        try {
          const stats = waterQualityService.getStatistics(minutes || 60);
          socket.emit('water:stats', stats);
        } catch (error) {
          socket.emit('error', { message: 'Failed to get statistics' });
        }
      });

      socket.on('water:request-alerts', (limit: number) => {
        const alerts = waterQualityService.getAlerts(limit || 50);
        socket.emit('water:alerts', alerts);
      });

      socket.on('disconnect', () => {
        this.connectedClients.delete(socket.id);
        logger.info(`Water quality client disconnected: ${socket.id}`, {
          totalClients: this.connectedClients.size,
        });
      });
    });
  }

  /**
   * Broadcast new reading to all connected clients
   */
  broadcastReading(reading: any): void {
    this.io.emit('water:new-reading', reading);
  }

  /**
   * Broadcast alert to all connected clients
   */
  broadcastAlert(alert: any): void {
    this.io.emit('water:alert', alert);
  }

  /**
   * Broadcast statistics update
   */
  broadcastStats(stats: any): void {
    this.io.emit('water:stats-update', stats);
  }

  /**
   * Get connected clients count
   */
  getConnectedClientsCount(): number {
    return this.connectedClients.size;
  }

  /**
   * Simulate real-time data from IoT device (for testing/demo)
   * Remove or modify this in production when connecting real ESP32
   */

}

/**
 * Initialize WebSocket for water quality monitoring
 */
export function initializeWaterQualityWebSocket(io: SocketIOServer): WaterQualityWebSocketHandler {
  return new WaterQualityWebSocketHandler(io);
}
