/**
 * Authenticated, device-scoped Socket.IO server for water quality data.
 */

import { Server as SocketIOServer, Socket } from 'socket.io';
import { Server as HTTPServer } from 'http';
import { logger } from '../utils/logger';
import { sensorReadingService } from '../services/sensorReadingService';
import { alertService } from '../services/alert.service';
import { deviceService } from '../services/device.service';
import { tokenService } from '../utils/tokenService';
import type { TokenPayload } from '../utils/tokenService';
import type { WaterQualityReading, WaterQualityStats } from '../iot/water/types';
import { config } from '../config/config';

interface SocketSession {
  token: string;
  userId: string;
  role: 'admin' | 'farmer' | 'guest';
}

export const getSessionTokenFromCookieHeader = (header: string | undefined, cookieName: string): string | null => {
  if (!header) return null;
  const prefix = `${cookieName}=`;
  const entry = header.split(';').map(part => part.trim()).find(part => part.startsWith(prefix));
  if (!entry) return null;
  try {
    const token = decodeURIComponent(entry.slice(prefix.length));
    return token || null;
  } catch {
    return null;
  }
};

export const resolveSocketSession = (header: string | undefined, cookieName: string): SocketSession | null => {
  const token = getSessionTokenFromCookieHeader(header, cookieName);
  const payload = token ? tokenService.verifyToken(token) : null;
  if (!token || !payload?.userId) return null;
  return { token, userId: payload.userId, role: payload.role || 'farmer' };
};

export const resolveSocketDeviceScope = async (
  session: Pick<SocketSession, 'userId' | 'role'>,
  listDevices: (userId: string) => Promise<Array<{ deviceId: string; isActive: boolean }>>,
): Promise<string[] | undefined> => {
  if (session.role === 'admin') return undefined;
  return (await listDevices(session.userId)).filter(device => device.isActive).map(device => device.deviceId);
};

const roleOf = (payload: TokenPayload): SocketSession['role'] => payload.role || 'farmer';

class WaterQualityWebSocketServer {
  private io: SocketIOServer;
  private connectedClients = new Set<string>();

  constructor(httpServer: HTTPServer) {
    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: config.cors.origin,
        credentials: true,
        methods: ['GET', 'POST'],
      },
      transports: ['websocket', 'polling'],
    });

    this.io.use((socket, next) => {
      const session = resolveSocketSession(socket.request.headers.cookie, config.authCookie.name);
      if (!session) {
        next(new Error('Authentication required'));
        return;
      }
      socket.data.session = session;
      next();
    });

    this.setupEventHandlers();
    this.startDataSimulation();
    logger.info('Socket.io WebSocket server initialized');
  }

  private session(socket: Socket): SocketSession | null {
    const session = socket.data.session as SocketSession | undefined;
    if (!session) return null;
    const payload = tokenService.verifyToken(session.token);
    if (!payload || payload.userId !== session.userId) return null;
    return { ...session, role: roleOf(payload) };
  }

  private async deviceIds(session: SocketSession): Promise<string[] | undefined> {
    return resolveSocketDeviceScope(session, userId => deviceService.listByUser(userId));
  }

  private async runForSession(socket: Socket, action: (session: SocketSession, deviceIds: string[] | undefined) => Promise<void>): Promise<void> {
    const session = this.session(socket);
    if (!session) {
      socket.disconnect(true);
      return;
    }
    try {
      await action(session, await this.deviceIds(session));
    } catch (error) {
      logger.warn('WebSocket request failed', error);
      socket.emit('error', { message: 'Failed to retrieve water quality data' });
    }
  }

  private setupEventHandlers(): void {
    this.io.on('connection', (socket: Socket) => {
      this.connectedClients.add(socket.id);
      logger.info(`Water quality client connected: ${socket.id}`, { totalClients: this.connectedClients.size });

      const expiryCheck = setInterval(() => {
        if (!this.session(socket)) socket.disconnect(true);
      }, 30_000);
      expiryCheck.unref();
      void this.runForSession(socket, (_session, deviceIds) => this.emitSnapshot(socket, 60, deviceIds));

      socket.on('water:request-latest', () => {
        void this.runForSession(socket, async (_session, deviceIds) => {
          socket.emit('water:latest', await sensorReadingService.getLatestReading(deviceIds));
        });
      });
      socket.on('water:request-stats', (minutes: number) => {
        void this.runForSession(socket, async (_session, deviceIds) => {
          socket.emit('water:stats', await this.getDbBackedStats(minutes || 60, deviceIds));
        });
      });
      socket.on('water:request-alerts', (limit: number) => {
        void this.runForSession(socket, async (_session, deviceIds) => {
          socket.emit('water:alerts', await alertService.getAlerts(limit || 50, undefined, deviceIds));
        });
      });
      socket.on('water:request-history', (minutes: number) => {
        void this.runForSession(socket, async (_session, deviceIds) => {
          socket.emit('water:history', await sensorReadingService.getReadingsByTimeRange(minutes || 60, deviceIds));
        });
      });
      socket.on('disconnect', () => {
        clearInterval(expiryCheck);
        this.connectedClients.delete(socket.id);
        logger.info(`Water quality client disconnected: ${socket.id}`, { totalClients: this.connectedClients.size });
      });
    });
  }

  private async emitSnapshot(socket: Socket, minutes: number, deviceIds: string[] | undefined): Promise<void> {
    const latest = await sensorReadingService.getLatestReading(deviceIds);
    socket.emit('water:latest', latest);
    socket.emit('water:stats', await this.getDbBackedStats(minutes, deviceIds));
    socket.emit('water:history', await sensorReadingService.getReadingsByTimeRange(minutes, deviceIds));
  }

  private async getDbBackedStats(minutes: number, deviceIds?: string[]): Promise<WaterQualityStats> {
    const dbStats = await sensorReadingService.getStatistics(minutes, deviceIds);
    return {
      timestamp: new Date(),
      orp: dbStats.orp,
      temperature: { current: dbStats.temperature.current, average: dbStats.temperature.average, min: dbStats.temperature.min, max: dbStats.temperature.max },
      ph: { current: dbStats.ph.current, average: dbStats.ph.average, min: dbStats.ph.min, max: dbStats.ph.max },
      do: { current: dbStats.do.current, average: dbStats.do.average, min: dbStats.do.min, max: dbStats.do.max },
      turbidity: { current: dbStats.turbidity.current, average: dbStats.turbidity.average, min: dbStats.turbidity.min, max: dbStats.turbidity.max },
      ammonia: { current: dbStats.ammonia.current, average: dbStats.ammonia.average, min: dbStats.ammonia.min, max: dbStats.ammonia.max },
      healthScore: dbStats.healthScore,
    };
  }

  /** Send live records only to administrators and the active owner of the record's device. */
  broadcastReading(reading: WaterQualityReading): void {
    const deviceId = (reading as unknown as { deviceId?: string }).deviceId;
    if (!deviceId) return;
    void (async () => {
      const device = await deviceService.getActiveDevice(deviceId);
      if (!device) return;
      for (const socket of this.io.sockets.sockets.values()) {
        const session = this.session(socket);
        if (!session) { socket.disconnect(true); continue; }
        if (session.role === 'admin' || session.userId === device.userId) socket.emit('water:new-reading', reading);
      }
    })().catch(error => logger.warn('Failed to scope live reading broadcast', error));
  }

  broadcastAlert(alert: { deviceId?: string; [key: string]: unknown }): void {
    void (async () => {
      const device = alert?.deviceId ? await deviceService.getActiveDevice(alert.deviceId) : null;
      for (const socket of this.io.sockets.sockets.values()) {
        const session = this.session(socket);
        if (!session) { socket.disconnect(true); continue; }
        if (session.role === 'admin' || (device && session.userId === device.userId)) socket.emit('water:alert', alert);
      }
    })().catch(error => logger.warn('Failed to scope alert broadcast', error));
  }

  /** Recompute per owner; never broadcast global statistics. */
  broadcastStats(_stats: unknown): void {
    for (const socket of this.io.sockets.sockets.values()) {
      void this.runForSession(socket, async (_session, deviceIds) => {
        socket.emit('water:stats-update', await this.getDbBackedStats(60, deviceIds));
      });
    }
  }

  public getConnectedClientsCount(): number { return this.connectedClients.size; }

  private startDataSimulation(): void {
    const baseUrl = `http://${config.server.host}:${config.server.port}`;
    logger.info('✓ Backend in preparation mode - ready to receive ESP32 sensor data via API');
    logger.info(`✓ ESP32 should POST to: ${baseUrl}/api/v1/water/readings`);
    logger.info('✓ Request format: { temperature, ph, do, turbidity, location, timestamp }');
  }
}

export { WaterQualityWebSocketServer };
