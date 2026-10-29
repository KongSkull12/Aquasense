/**
 * Custom hook for WebSocket connection to water quality monitoring
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { Socket, io } from 'socket.io-client';
import type { WaterQualityReading, WaterQualityStats, HealthAlert } from '../types/water';
import { WEBSOCKET_URL } from '../config/runtime';

interface UseWaterQualityWebSocketOptions {
  autoConnect?: boolean;
  url?: string;
}

const parseTimestamp = (value: unknown): number | null => {
  if (value instanceof Date) {
    const timestamp = value.getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const timestamp = Date.parse(value);
    return Number.isFinite(timestamp) ? timestamp : null;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return null;
};

const isOlderReading = (incoming: WaterQualityReading, current: WaterQualityReading | null): boolean => {
  // Acquisition time is authoritative. An invalid incoming timestamp must not
  // be made acceptable by falling back to the database insertion time.
  const incomingTimestamp = parseTimestamp(incoming?.timestamp);
  if (incomingTimestamp === null) return true;
  if (!current) return false;

  const currentTimestamp = parseTimestamp(current.timestamp);
  if (currentTimestamp !== null) return incomingTimestamp <= currentTimestamp;
  if (current.timestamp != null) return true;

  // If the current record has no acquisition timestamp, compare DB timestamps
  // only when both are valid. Otherwise recency cannot be established safely.
  const incomingCreatedAt = parseTimestamp(incoming.createdAt);
  const currentCreatedAt = parseTimestamp(current.createdAt);
  if (incomingCreatedAt === null || currentCreatedAt === null) return true;
  return incomingCreatedAt <= currentCreatedAt;
};

export const useWaterQualityWebSocket = (options: UseWaterQualityWebSocketOptions = {}) => {
  const { autoConnect = true, url = WEBSOCKET_URL } = options;

  const [isConnected, setIsConnected] = useState(false);
  const [latestReading, setLatestReading] = useState<WaterQualityReading | null>(null);
  const [historyReadings, setHistoryReadings] = useState<WaterQualityReading[]>([]);
  const [statistics, setStatistics] = useState<WaterQualityStats | null>(null);
  const [alerts, setAlerts] = useState<HealthAlert[]>([]);
  const [error, setError] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Initialize WebSocket connection
  useEffect(() => {
    if (!autoConnect) {
      return;
    }

    try {
      socketRef.current = io(url, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 10000,
        reconnectionAttempts: Infinity, // Keep trying indefinitely
        timeout: 5000,
        query: {
          client: 'frontend',
          timestamp: new Date().toISOString(),
        },
      });

      // Connection event handlers
      socketRef.current.on('connect', () => {
        console.log('[WebSocket] Connected successfully');
        setIsConnected(true);
        setError(null);
        setStatistics((current) => current ? { ...current, stale: true } : current);
      });

      socketRef.current.on('disconnect', (reason: string) => {
        console.warn('[WebSocket] Disconnected', reason);
        setIsConnected(false);
        setStatistics((current) => current ? { ...current, stale: true } : current);
        
        // Auto-reconnect if it was an unexpected disconnect
        if (reason !== 'io client namespace disconnect' && reason !== 'io server namespace disconnect') {
          setError('Connection lost, attempting to reconnect...');
        }
      });

      socketRef.current.on('connect_error', (err: Error) => {
        console.error('[WebSocket] Connection error:', err.message);
        setError(`Connection error: ${err.message}`);
        setIsConnected(false);
      });

      socketRef.current.on('error', (err: Error | string) => {
        const errorMsg = typeof err === 'string' ? err : err.message;
        console.error('[WebSocket] Error:', errorMsg);
        setError(`Server error: ${errorMsg}`);
      });

      // Reconnect attempt event for debugging
      socketRef.current.on('reconnect_attempt', () => {
        console.log('[WebSocket] Attempting to reconnect...');
        setError('Reconnecting to server...');
      });

      socketRef.current.on('reconnect_failed', () => {
        console.error('[WebSocket] Reconnection failed');
        setError('Failed to reconnect. Will keep trying...');
      });

      // Water quality event handlers
      socketRef.current.on('water:latest', (data: WaterQualityReading) => {
        setLatestReading((current) => isOlderReading(data, current) ? current : data);
        setError(null); // Clear error on successful data
      });

      socketRef.current.on('water:new-reading', (data: WaterQualityReading) => {
        setLatestReading((current) => isOlderReading(data, current) ? current : data);
      });

      socketRef.current.on('water:history', (data: WaterQualityReading[]) => {
        setHistoryReadings(Array.isArray(data) ? data : []);
      });

      socketRef.current.on('water:stats', (data: WaterQualityStats) => {
        setStatistics({ ...data, stale: false });
      });

      socketRef.current.on('water:stats-update', (data: WaterQualityStats) => {
        setStatistics({ ...data, stale: false });
      });

      socketRef.current.on('water:alerts', (data: HealthAlert[]) => {
        setAlerts(data);
      });

      socketRef.current.on('water:alert', (data: HealthAlert) => {
        setAlerts((prev) => [data, ...prev.slice(0, 9)]);
      });

      return () => {
        if (socketRef.current) {
          socketRef.current.disconnect();
        }
      };
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to initialize connection';
      setError(errorMessage);
      console.error('[WebSocket] Initialization error:', err);
      return undefined;
    }
  }, [autoConnect, url]);

  // Helper functions
  const requestLatestReading = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('water:request-latest');
    }
  }, []);

  const requestStatistics = useCallback((minutes: number = 60) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('water:request-stats', minutes);
    }
  }, []);

  const requestAlerts = useCallback((limit: number = 50) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('water:request-alerts', limit);
    }
  }, []);

  const requestHistory = useCallback((minutes: number = 60) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit('water:request-history', minutes);
    }
  }, []);

  return {
    isConnected,
    latestReading,
    historyReadings,
    statistics,
    alerts,
    error,
    requestLatestReading,
    requestStatistics,
    requestAlerts,
    requestHistory,
  };
};
