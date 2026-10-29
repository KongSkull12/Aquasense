/**
 * MQTT Service
 * Connects to MQTT broker and subscribes to ESP32 sensor data
 * Processes incoming messages and feeds them to waterQualityService
 */

import mqtt, { MqttClient } from 'mqtt';
import fs from 'fs';
import { numeric } from './sensorHealth';
import { logger } from '../utils/logger';
import { sensorReadingService } from './sensorReadingService';
import { waterAlertNotificationService } from './waterAlertNotification.service';
import type { WaterQualityReading, WaterQualityStats } from '../iot/water/types';
import { config as appConfig } from '../config/config';
import { HardwareCommand } from '../database/models/HardwareControl';
import { FeedingCommand } from '../database/models/FeedingCommand';
import { deviceService } from './device.service';
import { ackCanonical, commandCanonical, parseSignedAck, signCanonical, verifyCanonical } from './hardwareProtocol';
import { hardwareService } from './hardwareService';

interface MQTTConfig {
  brokerUrl: string;
  username?: string;
  password?: string;
  clientId?: string;
  topics: {
    readings: string;
    sensorWildcard: string;
    commands: string;
    status: string;
  };
}

const PUBLIC_MQTT_MAX_FRAME_BYTES = 4096;
const PUBLIC_MQTT_MIN_FRAME_INTERVAL_MS = 4500;

export const sanitizeBrokerUrl = (brokerUrl: string): string => {
  try {
    const parsed = new URL(brokerUrl);
    if (!parsed.protocol || !parsed.hostname) return 'invalid-broker-url';
    return `${parsed.protocol}//${parsed.hostname}${parsed.port ? `:${parsed.port}` : ''}`;
  } catch {
    return 'invalid-broker-url';
  }
};

export class MQTTService {
  private client: MqttClient | null = null;
  private controlClient: MqttClient | null = null;
  private config: MQTTConfig;
  private isConnected = false;
  private reconnectInterval: NodeJS.Timeout | null = null;
  private latestSensorPayload: {
    temperature?: unknown;
    ph?: unknown;
    turbidity?: unknown;
    do?: unknown;
    ammonia?: unknown;
    orp?: unknown;
  } = {};
  private latestTurbidityUnit: 'raw_adc' | 'NTU' = 'raw_adc';
  private latestRawTurbidity: number | null = null;
  private latestDeviceId = 'mqtt-device';
  private pendingBatchFlags = {
    temperature: false,
    ph: false,
    turbidity: false,
  };
  private onReadingReceived?: (reading: WaterQualityReading) => void;
  private onStatsUpdated?: (stats: WaterQualityStats) => void;
  private lastConnectionWarningAt = 0;
  private sensorTimestamps: Record<string,string> = {};
  private latestDoReceivedAt = 0;
  private latestOrpReceivedAt = 0;
  private actuatorRedeliveryInterval: NodeJS.Timeout | null = null;
  private lastPublicFramePersistedAt: number | null = null;
  private publicFramePersistInProgress = false;
  private pendingPublicFrame: { payload: string; bootId: string; sequence: number } | null = null;
  private publicFrameDrainTimer: NodeJS.Timeout | null = null;
  private lastPublicFrameReceivedAt: string | null = null;
  private lastPublicFrameVerifiedAt: string | null = null;

  constructor(config?: Partial<MQTTConfig>) {
    this.config = {
      brokerUrl: config?.brokerUrl || appConfig.mqtt.brokerUrl,
      username: config?.username || appConfig.mqtt.username,
      password: config?.password || appConfig.mqtt.password,
      clientId: config?.clientId || `aquasense-backend-${Date.now()}`,
      topics: {
        readings: config?.topics?.readings || appConfig.mqtt.topics.readings,
        sensorWildcard: config?.topics?.sensorWildcard || appConfig.mqtt.topics.sensorWildcard,
        commands: config?.topics?.commands || appConfig.mqtt.topics.commands,
        status: config?.topics?.status || appConfig.mqtt.topics.status,
        ...config?.topics,
      },
    };
  }

  /**
   * Connect to MQTT broker and start listening
   */
  async connect(): Promise<void> {
    try {
      if (appConfig.mqtt.publicTelemetryOnly && !appConfig.device.keys[appConfig.mqtt.telemetryDeviceId]) {
        logger.error('Public MQTT telemetry frames will be rejected: configure DEVICE_KEYS for the configured telemetry device', {
          deviceId: appConfig.mqtt.telemetryDeviceId,
          requiredSetting: 'DEVICE_KEYS',
        });
      }

      const options: mqtt.IClientOptions = {
        clientId: this.config.clientId,
        clean: true,
        reconnectPeriod: 5000,
        username: appConfig.mqtt.publicTelemetryOnly ? undefined : this.config.username,
        password: appConfig.mqtt.publicTelemetryOnly ? undefined : this.config.password,
      };

      logger.info(`Connecting to MQTT Broker: ${sanitizeBrokerUrl(this.config.brokerUrl)}`);
      this.client = mqtt.connect(this.config.brokerUrl, options);

      // Connection established
      this.client.on('connect', () => {
        this.isConnected = true;
        logger.info('âœ“ MQTT Connected successfully');
        this.subscribe();
        if (!appConfig.mqtt.publicTelemetryOnly) {
          void this.redeliverPendingActuatorCommands();
          if (!this.actuatorRedeliveryInterval) this.actuatorRedeliveryInterval = setInterval(() => {
            void this.redeliverPendingActuatorCommands();
          }, 5000);
          this.publishStatus('online');
        }

        // Clear any existing reconnect interval
        if (this.reconnectInterval) {
          clearInterval(this.reconnectInterval);
          this.reconnectInterval = null;
        }
      });

      // New messages
      this.client.on('message', (topic: string, payload: Buffer, packet: mqtt.IPublishPacket) => {
        if (packet.retain) return;
        if (appConfig.mqtt.publicTelemetryOnly) {
          if (appConfig.mqtt.publicCommandsEnabled && this.isActuatorStateTopic(topic)) {
            void this.handleActuatorAck(topic, payload.toString());
          } else if (payload.byteLength <= PUBLIC_MQTT_MAX_FRAME_BYTES) {
            this.handlePublicTelemetryMessage(topic, payload);
          }
        } else {
          this.handleMessage(topic, payload);
        }
      });

      // Disconnection
      this.client.on('disconnect', () => {
        this.isConnected = false;
        logger.warn('MQTT disconnected, attempting to reconnect...');
      });

      // MQTT is optional for local development; REST sensor ingestion remains online
      // even when the public broker is unreachable.
      this.client.on('error', () => {
        const now = Date.now();
        if (now - this.lastConnectionWarningAt > 30000) {
          this.lastConnectionWarningAt = now;
          logger.warn('MQTT broker unavailable; backend is still running without MQTT data', {
            brokerUrl: sanitizeBrokerUrl(this.config.brokerUrl),
            message: 'Connection failed',
          });
        }
      });

      // Reconnection attempt
      this.client.on('reconnect', () => {
        logger.info('MQTT attempting to reconnect...');
      });

      // Public-dev commands are signed and use a namespace separate from telemetry.
      if (appConfig.mqtt.publicTelemetryOnly && !appConfig.mqtt.publicCommandsEnabled && appConfig.mqtt.actuatorCommandsEnabled &&
          appConfig.mqtt.controlBrokerUrl && appConfig.mqtt.controlCaCertPath) {
        const controlOptions: mqtt.IClientOptions = {
          clientId: `aquasense-control-${Date.now()}`,
          clean: true,
          reconnectPeriod: 5000,
          username: appConfig.mqtt.controlUsername,
          password: appConfig.mqtt.controlPassword,
          ca: fs.readFileSync(appConfig.mqtt.controlCaCertPath),
          rejectUnauthorized: true,
        };
        this.controlClient = mqtt.connect(appConfig.mqtt.controlBrokerUrl, controlOptions);
        this.controlClient.on('connect', () => {
          this.controlClient?.subscribe('aquasense/+/state', { qos: 1 });
          void this.redeliverPendingActuatorCommands();
          if (!this.actuatorRedeliveryInterval) this.actuatorRedeliveryInterval = setInterval(() => {
            void this.redeliverPendingActuatorCommands();
          }, 5000);
          logger.info('Private MQTT control channel connected', {
            brokerUrl: sanitizeBrokerUrl(appConfig.mqtt.controlBrokerUrl!),
          });
        });
        this.controlClient.on('message', (topic, payload, packet) => {
          if (!packet.retain && this.isActuatorStateTopic(topic)) void this.handleActuatorAck(topic, payload.toString());
        });
        this.controlClient.on('error', () => {
          logger.warn('Private MQTT control channel unavailable; dashboard actuator commands cannot be delivered', {
            brokerUrl: sanitizeBrokerUrl(appConfig.mqtt.controlBrokerUrl!),
          });
        });
      }
      this.startActuatorMaintenanceLoop();
    } catch (error) {
      logger.error('Failed to initialize MQTT connection', { brokerUrl: sanitizeBrokerUrl(this.config.brokerUrl) });
      throw error;
    }
  }

  /**
   * Subscribe to topics
   */
  private subscribe(): void {
    if (!this.client) return;

    try {
      const topics = appConfig.mqtt.publicTelemetryOnly
        ? [this.config.topics.sensorWildcard,
          ...(appConfig.mqtt.publicCommandsEnabled ? [`${appConfig.mqtt.controlTopicNamespace}/+/state`] : [])]
        : [this.config.topics.readings, this.config.topics.sensorWildcard, this.config.topics.commands, 'aquasense/+/state'];
      this.client.subscribe(topics, (err) => {
        if (err) {
          logger.error('MQTT subscription error:', err.message);
        } else {
          logger.info(`Subscribed to MQTT topics: ${topics.join(', ')}`);
        }
      });
    } catch (error) {
      logger.error('Failed to subscribe to MQTT topics:', error);
    }
  }

  private startActuatorMaintenanceLoop(): void {
    if (this.actuatorRedeliveryInterval) return;
    this.actuatorRedeliveryInterval = setInterval(() => {
      void this.redeliverPendingActuatorCommands();
    }, 5000);
  }

  /**
   * Handle incoming MQTT messages
   */
  private handleMessage(topic: string, payload: Buffer): void {
    try {
      const message = payload.toString();
      logger.debug(`[MQTT] Received on ${topic}: ${message.substring(0, 100)}`);

      if (topic === this.config.topics.readings) {
        this.handleSensorReading(message);
      } else if (this.isActuatorStateTopic(topic)) {
        void this.handleActuatorAck(topic, message);
      } else if (this.isAquasenseSensorTopic(topic)) {
        this.handleAquasenseTopicValue(topic, message);
      } else if (topic.startsWith('water/commands/')) {
        this.handleCommand(topic, message);
      }
    } catch (error) {
      logger.error(`Error processing MQTT message from ${topic}:`, error);
    }
  }

  private handlePublicTelemetryMessage(topic: string, payload: Buffer): void {
    const parts = topic.split('/');
    if (parts.length !== 5 || parts[0] !== appConfig.mqtt.topicNamespace || parts[1] !== 'devices' ||
        parts[2] !== appConfig.mqtt.telemetryDeviceId || parts[3] !== 'telemetry') return;

    // Public profile scalar topics have no source timestamp or sequence. Keep
    // accepting them on the broker for legacy observers, but never persist
    // them as current measurements. Only a complete source-timestamped frame
    // can enter the database in this profile.
    if (parts[4] === 'frame') {
      this.lastPublicFrameReceivedAt = new Date().toISOString();
      if (payload.byteLength > PUBLIC_MQTT_MAX_FRAME_BYTES) return;
      let envelope: any;
      try { envelope = JSON.parse(payload.toString('utf8')); } catch { return; }
      const deviceKey = appConfig.device.keys[parts[2]];
      if (!deviceKey || !envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          typeof envelope.frame !== 'string' || envelope.frame.length > 2048 ||
          typeof envelope.signature !== 'string' || !/^[a-f0-9]{64}$/i.test(envelope.signature) ||
          !verifyCanonical(envelope.frame, envelope.signature, deviceKey)) return;
      let frame: any;
      try { frame = JSON.parse(envelope.frame); } catch { return; }
      if (!frame || typeof frame !== 'object' || Array.isArray(frame) || frame.v !== 1 ||
          frame.deviceId !== parts[2] || typeof frame.bootId !== 'string' || frame.bootId.length > 64 ||
          !Number.isSafeInteger(frame.sequence) || frame.sequence < 0 ||
          typeof frame.acquiredAt !== 'string' || !Number.isFinite(Date.parse(frame.acquiredAt)) ||
          !frame.sensorTimestamps || typeof frame.sensorTimestamps !== 'object' ||
          !frame.sensors || typeof frame.sensors !== 'object' || frame.turbidityUnit !== 'NTU') return;
      const timestampNames = ['temperature', 'ph', 'turbidity', 'orp'];
      if (!timestampNames.every(name => typeof frame.sensorTimestamps[name] === 'string' &&
          Number.isFinite(Date.parse(frame.sensorTimestamps[name])))) return;
      this.latestDeviceId = parts[2];
      this.lastPublicFrameVerifiedAt = new Date().toISOString();
      void this.persistPublicMqttFrame(JSON.stringify(frame), frame.bootId, frame.sequence);
      return;
    }
    // Legacy scalar publications lack cycle identity and source timestamps.
    // They remain available to broker subscribers but are ignored for storage.
  }

  /** Publish one non-retained, signed actuator command. Publishing means queued, never confirmed. */
  async dispatchHardwareCommand(input: { id: string; deviceId: string; source: 'hardware' | 'feeding'; action: string; durationMs?: number; expiresAt: Date }): Promise<boolean> {
    if (!appConfig.mqtt.actuatorCommandsEnabled) return false;
    const publisher = appConfig.mqtt.publicTelemetryOnly && !appConfig.mqtt.publicCommandsEnabled
      ? this.controlClient : this.client;
    if (!publisher || (appConfig.mqtt.publicTelemetryOnly && !appConfig.mqtt.publicCommandsEnabled
      ? !publisher.connected : !this.isConnected)) return false;
    const key = appConfig.device.keys[input.deviceId];
    if (!key) return false;
    const unsigned = { v: 1 as const, deviceId: input.deviceId, id: input.id, source: input.source,
      action: input.action, durationMs: input.durationMs ?? 0, expiresAt: input.expiresAt.getTime() };
    const payload = JSON.stringify({ ...unsigned, signature: signCanonical(commandCanonical(unsigned), key) });
    return new Promise((resolve) => publisher.publish(`${appConfig.mqtt.controlTopicNamespace}/${input.deviceId}/command`, payload,
      { qos: 1, retain: false }, error => {
        if (error) { logger.warn('Actuator MQTT publish failed', { deviceId: input.deviceId, commandId: input.id, error: error.message }); resolve(false); }
        else resolve(true);
      }));
  }

  /** Return true only when the configured command publisher is connected. */
  isActuatorCommandChannelConnected(): boolean {
    if (!appConfig.mqtt.actuatorCommandsEnabled) return false;
    const publicControl = appConfig.mqtt.publicTelemetryOnly && appConfig.mqtt.publicCommandsEnabled;
    const privateControl = appConfig.mqtt.publicTelemetryOnly && !appConfig.mqtt.publicCommandsEnabled;
    const publisher = privateControl ? this.controlClient : this.client;
    return !!publisher?.connected && (privateControl || this.isConnected || publicControl);
  }

  /** Fresh verified telemetry is the device liveness signal in public-dev mode. */
  isTelemetryDeviceOnline(deviceId: string, maxAgeMs = 20_000): boolean {
    if (!appConfig.mqtt.publicTelemetryOnly || deviceId !== appConfig.mqtt.telemetryDeviceId ||
        !this.lastPublicFrameVerifiedAt) return false;
    const ageMs = Date.now() - Date.parse(this.lastPublicFrameVerifiedAt);
    return Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= maxAgeMs;
  }

  private async redeliverPendingActuatorCommands(): Promise<void> {
    if (!this.isActuatorCommandChannelConnected()) {
      try { await hardwareService.expirePendingCommands(); }
      catch (error) { logger.error('Failed to expire undelivered actuator commands', error); }
      return;
    }
    try {
      const [hardware, feeding] = await Promise.all([
        HardwareCommand.findAll({ where: { status: 'PENDING' }, order: [['createdAt', 'ASC']], limit: 100 }),
        FeedingCommand.findAll({ where: { status: 'PENDING', source: 'MANUAL' }, order: [['createdAt', 'ASC']], limit: 100 }),
      ]);
      const now = Date.now();
      for (const command of hardware) {
        if (command.expiresAt.getTime() <= now) continue;
        if (!(await deviceService.verifyOwnership(command.userId, command.deviceId))) continue;
        await this.dispatchHardwareCommand({ id: command.id, deviceId: command.deviceId, source: 'hardware', action: command.action,
          durationMs: command.durationMs ?? undefined, expiresAt: command.expiresAt });
      }
      for (const command of feeding) {
        const expiresAt = command.createdAt.getTime() + 120_000;
        if (expiresAt <= now || !(await deviceService.verifyOwnership(command.userId, command.deviceId))) continue;
        await this.dispatchHardwareCommand({ id: command.id, deviceId: command.deviceId, source: 'feeding', action: command.action,
          expiresAt: new Date(expiresAt) });
      }
      // Expired commands are not redelivered after a reconnect/outage.
      await hardwareService.expirePendingCommands();
    } catch (error) { logger.error('Actuator command redelivery failed', error); }
  }

  private async handleActuatorAck(topic: string, payload: string): Promise<void> {
    const ack = parseSignedAck(payload);
    const topicDeviceId = topic.split('/')[1];
    if (!ack || ack.deviceId !== topicDeviceId) { logger.warn('Rejected malformed actuator state/ack', { topic }); return; }
    const key = appConfig.device.keys[ack.deviceId];
    if (!key || !verifyCanonical(ackCanonical(ack), ack.signature, key)) {
      logger.warn('Rejected actuator state/ack with invalid signature', { deviceId: ack.deviceId, commandId: ack.id }); return;
    }
    try {
      const device = await deviceService.getActiveDevice(ack.deviceId);
      if (!device) return;
      const accepted = await hardwareService.acceptMqttAck(device.userId, ack);
      if (!accepted) logger.warn('Rejected out-of-scope actuator state/ack', { deviceId: ack.deviceId, commandId: ack.id });
    } catch (error) { logger.error('Failed to persist actuator state/ack', error); }
  }

  private isActuatorStateTopic(topic: string): boolean {
    const namespace = appConfig.mqtt.controlTopicNamespace.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${namespace}/[^/]+/state$`).test(topic);
  }

  /**
   * Process sensor reading from ESP32
   * Expected format: {temperature, ph, do, turbidity, location?, timestamp?}
   */
  private async handleSensorReading(payload: string): Promise<boolean> {
    let ingested = false;
    try {
      const data = JSON.parse(payload);
      if (!data || typeof data !== 'object' || Array.isArray(data)) return false;
      const deviceId = typeof data.deviceId === 'string' ? data.deviceId : 'mqtt-device';
      const result = await sensorReadingService.ingestWithStatus(deviceId, data);
      if (!result.inserted) return false;
      const reading = result.reading;
      ingested = true;
      this.onReadingReceived?.(reading);
      await waterAlertNotificationService.processReading({...reading, dissolvedOxygen:reading.do, dissolvedOxygenMeasured:reading.doMeasured}).catch(error=>logger.error('Post-ingestion notification failed', {deviceId, readingId:reading.id, error:String(error)}));
      const stats = await sensorReadingService.getStatistics(60);
      this.onStatsUpdated?.({...stats,timestamp:new Date()});
    } catch { logger.warn('Malformed sensor payload or ingestion failed'); }
    return ingested;
  }

  private async persistPublicMqttFrame(payload: string, bootId: string, sequence: number): Promise<void> {
    const pending = this.pendingPublicFrame;
    // Keep only the newest frame for a boot; duplicate or out-of-order delivery
    // must not replace a newer frame waiting for the rate limit to expire.
    if (pending?.bootId === bootId && sequence <= pending.sequence) return;
    this.pendingPublicFrame = { payload, bootId, sequence };
    await this.drainPublicMqttFrame();
  }

  private async drainPublicMqttFrame(): Promise<void> {
    if (this.publicFramePersistInProgress || !this.pendingPublicFrame) return;
    const waitMs = this.lastPublicFramePersistedAt === null
      ? 0
      : PUBLIC_MQTT_MIN_FRAME_INTERVAL_MS - (Date.now() - this.lastPublicFramePersistedAt);
    if (waitMs > 0) {
      if (!this.publicFrameDrainTimer) {
        this.publicFrameDrainTimer = setTimeout(() => {
          this.publicFrameDrainTimer = null;
          void this.drainPublicMqttFrame();
        }, waitMs);
      }
      return;
    }
    if (this.publicFrameDrainTimer) {
      clearTimeout(this.publicFrameDrainTimer);
      this.publicFrameDrainTimer = null;
    }

    const frame = this.pendingPublicFrame;
    this.pendingPublicFrame = null;
    this.publicFramePersistInProgress = true;
    try {
      if (await this.handleSensorReading(frame.payload)) this.lastPublicFramePersistedAt = Date.now();
    } finally {
      this.publicFramePersistInProgress = false;
      if (this.pendingPublicFrame) void this.drainPublicMqttFrame();
    }
  }

  setRealtimeHandlers(handlers: {
    onReadingReceived?: (reading: WaterQualityReading) => void;
    onStatsUpdated?: (stats: WaterQualityStats) => void;
  }): void {
    this.onReadingReceived = handlers.onReadingReceived;
    this.onStatsUpdated = handlers.onStatsUpdated;
  }

  /**
   * Handle topic-per-parameter payloads, e.g.:
   * aquasense/temperature => 26.4
   * aquasense/ph => 7.19
   * aquasense/turbidity => 324
   */
  private handleAquasenseTopicValue(topic: string, payload: string): void {
    const topicSuffix = topic.split('/').pop();
    const parsed = numeric(payload);
    const value = parsed;

    if (topicSuffix) this.sensorTimestamps[topicSuffix] = new Date().toISOString();
    switch (topicSuffix) {
      case 'device-id':
        if (payload.trim()) this.latestDeviceId = payload.trim();
        return;
      case 'temperature':
        this.latestSensorPayload.temperature = value ?? undefined;
        this.pendingBatchFlags.temperature = true;
        break;
      case 'ph':
        this.latestSensorPayload.ph = value ?? undefined;
        this.pendingBatchFlags.ph = true;
        break;
      case 'turbidity': {
        if (value === null) {
          this.latestRawTurbidity = null;
          this.latestSensorPayload.turbidity = undefined;
          this.pendingBatchFlags.turbidity = false;
          break;
        }
        this.latestRawTurbidity = value;
        // The firmware publishes raw ADC and reported NTU separately. Keep ADC
        // as diagnostic metadata when an NTU sample is also arriving; it must
        // not replace that sample or create a second mixed-unit frame.
        const ntuAt = Date.parse(this.sensorTimestamps['turbidity-ntu'] ?? '');
        if (!Number.isFinite(ntuAt) || Date.now() - ntuAt > 15000) {
          this.latestSensorPayload.turbidity = value;
          this.latestTurbidityUnit = 'raw_adc';
          this.pendingBatchFlags.turbidity = true;
        }
        break;
      }
      case 'turbidity-ntu':
        this.latestSensorPayload.turbidity = value ?? undefined;
        this.latestTurbidityUnit = 'NTU';
        this.pendingBatchFlags.turbidity = true;
        break;
      case 'orp':
        this.latestSensorPayload.orp = value;
        this.latestOrpReceivedAt = Date.now();
        break;
      case 'do':
      case 'dissolved-oxygen':
        this.latestSensorPayload.do = value;
        this.latestDoReceivedAt = Date.now();
        break;
      case 'ammonia':
      case 'nh3':
        this.latestSensorPayload.ammonia = value;
        break;
      default:
        logger.debug(`[MQTT] Unsupported aquasense topic suffix: ${topicSuffix}`);
        return;
    }

    const requiredTimestamps = ['temperature', 'ph', this.latestTurbidityUnit === 'NTU' ? 'turbidity-ntu' : 'turbidity'];
    const frameFresh = requiredTimestamps.every(name => {
      const at = Date.parse(this.sensorTimestamps[name] ?? '');
      return Number.isFinite(at) && Date.now() - at <= 15000;
    });
    if (
      (this.pendingBatchFlags.temperature &&
      this.pendingBatchFlags.ph &&
      this.pendingBatchFlags.turbidity &&
      frameFresh &&
      this.latestSensorPayload.temperature !== undefined &&
      this.latestSensorPayload.ph !== undefined &&
      this.latestSensorPayload.turbidity !== undefined)
    ) {
      const normalizedPayload = {
        deviceId: this.latestDeviceId,
        temperature: this.latestSensorPayload.temperature,
        ph: this.latestSensorPayload.ph,
        do: Date.now() - this.latestDoReceivedAt <= 15000 ? this.latestSensorPayload.do : undefined,
        turbidity: this.latestSensorPayload.turbidity,
        turbidityUnit: this.latestTurbidityUnit,
        sensors: this.latestTurbidityUnit === 'NTU' && this.latestRawTurbidity !== null && Date.now() - Date.parse(this.sensorTimestamps.turbidity ?? '') <= 15000
          ? { turbidity: { rawAdc: this.latestRawTurbidity } }
          : undefined,
        orp: Date.now() - this.latestOrpReceivedAt <= 15000 ? this.latestSensorPayload.orp ?? null : null,
        sensorTimestamps: {
          ...this.sensorTimestamps,
          turbidity: this.sensorTimestamps[this.latestTurbidityUnit === 'NTU' ? 'turbidity-ntu' : 'turbidity'],
        },
        location: 'ESP32-MQTT',
        timestamp: new Date().toISOString(),
      };

      this.pendingBatchFlags = {
        temperature: false,
        ph: false,
        turbidity: false,
      };
      this.latestSensorPayload.temperature = undefined;
      this.latestSensorPayload.ph = undefined;
      this.latestSensorPayload.turbidity = undefined;

      const serialized = JSON.stringify(normalizedPayload);
      if (!appConfig.mqtt.publicTelemetryOnly) void this.handleSensorReading(serialized);
    }
  }

  private isAquasenseSensorTopic(topic: string): boolean {
    return topic.startsWith('aquasense/');
  }

  /**
   * Handle remote commands
   */
  private handleCommand(topic: string, payload: string): void {
    try {
      const command = topic.split('/').pop();
      const data = JSON.parse(payload);

      logger.info(`[MQTT Command] ${command}:`, data);

      switch (command) {
        case 'threshold-update':
          logger.info('Threshold update command received (handled by API configuration layer)');
          break;

        case 'restart':
          logger.warn('Restart command received - would restart device');
          break;

        default:
          logger.debug(`Unknown command: ${command}`);
      }
    } catch (error) {
      logger.error('Error handling MQTT command:', error);
    }
  }

  /**
   * Publish device status
   */
  private publishStatus(status: 'online' | 'offline'): void {
    if (!this.client || !this.isConnected || appConfig.mqtt.publicTelemetryOnly) return;

    const message = JSON.stringify({
      status,
      timestamp: new Date(),
      uptime: process.uptime(),
    });

    this.client.publish(this.config.topics.status, message, { qos: 1, retain: true }, (err) => {
      if (err) {
        logger.error('Failed to publish status:', err.message);
      } else {
        logger.debug(`Published status: ${status}`);
      }
    });
  }

  /**
   * Disconnect from MQTT broker
   */
  async disconnect(): Promise<void> {
    if (this.actuatorRedeliveryInterval) { clearInterval(this.actuatorRedeliveryInterval); this.actuatorRedeliveryInterval = null; }
    if (this.publicFrameDrainTimer) { clearTimeout(this.publicFrameDrainTimer); this.publicFrameDrainTimer = null; }
    this.pendingPublicFrame = null;
    if (this.controlClient) {
      this.controlClient.end(false);
      this.controlClient = null;
    }
    return new Promise((resolve) => {
      if (!this.client) {
        resolve();
        return;
      }

      if (!appConfig.mqtt.publicTelemetryOnly) this.publishStatus('offline');
      this.client.end(false, () => {
        this.isConnected = false;
        logger.info('âœ“ MQTT disconnected');
        resolve();
      });
    });
  }

  /**
   * Check connection status
   */
  getStatus(): {
    connected: boolean;
    brokerUrl: string;
    subscribedTopics: string[];
    lastPublicFrameReceivedAt: string | null;
    lastPublicFrameVerifiedAt: string | null;
    lastPublicFramePersistedAt: string | null;
  } {
    return {
      connected: this.isConnected,
      brokerUrl: sanitizeBrokerUrl(this.config.brokerUrl),
      subscribedTopics: appConfig.mqtt.publicTelemetryOnly
        ? [this.config.topics.sensorWildcard,
          ...(appConfig.mqtt.publicCommandsEnabled ? [`${appConfig.mqtt.controlTopicNamespace}/+/state`] : [])]
        : [this.config.topics.readings, this.config.topics.sensorWildcard, this.config.topics.commands],
      lastPublicFrameReceivedAt: this.lastPublicFrameReceivedAt,
      lastPublicFrameVerifiedAt: this.lastPublicFrameVerifiedAt,
      lastPublicFramePersistedAt: this.lastPublicFramePersistedAt === null
        ? null
        : new Date(this.lastPublicFramePersistedAt).toISOString(),
    };
  }
}

// Export singleton instance
export const mqttService = new MQTTService();
