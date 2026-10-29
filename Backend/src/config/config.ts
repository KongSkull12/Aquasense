import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { z } from 'zod';

const publicDevProfile = process.env.AQUASENSE_CONFIG_PROFILE === 'public-dev';
const PUBLIC_DEV_BROKER_URL = 'mqtt://broker.hivemq.com:1883';
const PUBLIC_DEV_DEVICE_ID = 'esp32-feeder-1';
const backendDir = path.resolve(__dirname, '..', '..');
const envPath = path.join(backendDir, publicDevProfile ? '.env.public-dev' : '.env');
// Tests never load deployment secrets or override their isolated environment.
const fileEnv = process.env.NODE_ENV === 'test' ? {} : publicDevProfile
  ? {
    ...(fs.existsSync(path.join(backendDir, '.env'))
      ? dotenv.parse(fs.readFileSync(path.join(backendDir, '.env')))
      : {}),
    ...(dotenv.config({ path: envPath, override: false }).parsed || {}),
  }
  : dotenv.config({ path: envPath, override: false }).parsed || {};
// Public-dev supports signed, device-scoped commands in a separate HiveMQ
// namespace. The separate private broker remains available as a fallback.
const privateControlEnv: Record<string, string> = process.env.NODE_ENV === 'test' || !publicDevProfile ||
  !fs.existsSync(path.join(backendDir, '.env'))
  ? {}
  : dotenv.parse(fs.readFileSync(path.join(backendDir, '.env')));

const assertProfileSetting = (key: string, expected: string): void => {
  const fromFile = fileEnv[key];
  const fromProcess = process.env[key];
  if (fromFile !== expected || (fromProcess !== undefined && fromProcess !== expected)) {
    throw new Error(`Public development profile requires ${key} to match its profile configuration`);
  }
};

if (publicDevProfile && process.env.NODE_ENV !== 'test') {
  const profileBroker = fileEnv.MQTT_BROKER_URL;
  if (profileBroker !== PUBLIC_DEV_BROKER_URL ||
      (process.env.MQTT_BROKER_URL !== undefined && process.env.MQTT_BROKER_URL !== PUBLIC_DEV_BROKER_URL)) {
    throw new Error('Public development profile requires the exact configured HiveMQ broker URL');
  }
  if ((fileEnv.FEEDER_DEVICE_ID !== undefined && fileEnv.FEEDER_DEVICE_ID !== PUBLIC_DEV_DEVICE_ID) ||
      (process.env.FEEDER_DEVICE_ID !== undefined && process.env.FEEDER_DEVICE_ID !== PUBLIC_DEV_DEVICE_ID)) {
    throw new Error('Public development profile device ID must match the firmware configuration');
  }
  assertProfileSetting('MQTT_DEVICE_SCOPED_TOPICS', 'true');
  assertProfileSetting('MQTT_ACTUATOR_COMMANDS_ENABLED', 'true');
  assertProfileSetting('MQTT_PUBLIC_COMMANDS_ENABLED', 'true');
  if (!fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE || !/^[A-Za-z0-9_-]{3,48}$/.test(fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE)) {
    throw new Error('Public development profile requires a valid MQTT_CONTROL_TOPIC_NAMESPACE');
  }
  if (!fileEnv.PORT) throw new Error('Public development profile requires a configured server port');
  assertProfileSetting('PORT', fileEnv.PORT);
  if (!fileEnv.MQTT_TOPIC_NAMESPACE || !/^[A-Za-z0-9_-]{3,48}$/.test(fileEnv.MQTT_TOPIC_NAMESPACE)) {
    throw new Error('Public development profile requires a valid MQTT_TOPIC_NAMESPACE');
  }
  if (fileEnv.MQTT_TOPIC_NAMESPACE === fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE) {
    throw new Error('Public telemetry and actuator commands must use separate MQTT namespaces');
  }
}

const getEnv = (key: string, fallback?: string): string | undefined => {
  if (process.env[key] !== undefined) {
    return process.env[key];
  }
  if (fileEnv[key] !== undefined) {
    return fileEnv[key];
  }
  return fallback;
};

const getOptionalCredential = (key: string): string | undefined => {
  const value = getEnv(key)?.trim();
  if (!value || /^<[^>]+>$|replace-with|changeme|your[-_]/i.test(value)) {
    return undefined;
  }
  return value;
};

const parseDeviceKeys = (raw?: string): Record<string, string> => {
  if (!raw) {
    return {};
  }

  return raw
    .split(',')
    .map((pair) => pair.trim())
    .filter((pair) => pair.length > 0)
    .reduce<Record<string, string>>((acc, pair) => {
      const [deviceId, key] = pair.split(':').map((part) => part.trim());
      if (deviceId && key) {
        acc[deviceId] = key;
      }
      return acc;
    }, {});
};

const isPublicHiveMqUrl = (raw?: string): boolean => {
  try {
    const hostname = new URL(raw || '').hostname.toLowerCase();
    return hostname === 'broker.hivemq.com' || hostname.endsWith('.hivemq.cloud');
  } catch {
    return true;
  }
};

const nodeEnv = getEnv('NODE_ENV', 'development') || 'development';
const mqttNamespace = publicDevProfile ? (fileEnv.MQTT_TOPIC_NAMESPACE || '') : (getEnv('MQTT_TOPIC_NAMESPACE') || 'aquasense');
const telemetryDeviceId = publicDevProfile
  ? PUBLIC_DEV_DEVICE_ID
  : (getEnv('FEEDER_DEVICE_ID', 'esp32-feeder-1') || 'esp32-feeder-1');

/**
 * Application configuration
 */
export const config = {
  server: {
    nodeEnv,
    port: parseInt(getEnv('PORT', '5001') || '5001', 10),
    host: getEnv('HOST', 'localhost') || 'localhost',
  },
  api: {
    version: getEnv('API_VERSION', 'v1') || 'v1',
  },
  logging: {
    level: getEnv('LOG_LEVEL', 'info') || 'info',
  },
  cors: {
    origin: getEnv('CORS_ORIGIN')?.split(',') || ['http://localhost:3000', 'http://localhost:3001'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Key', 'X-CSRF-Token'],
  },
  database: {
    host: getEnv('DB_HOST', 'localhost') || 'localhost',
    port: parseInt(getEnv('DB_PORT', '5432') || '5432', 10),
    name: getEnv('DB_NAME', 'AquaSense') || 'AquaSense',
    user: getEnv('DB_USER', 'postgres') || 'postgres',
    password: getEnv('DB_PASSWORD') || '',
    dialect: (getEnv('DB_DIALECT', 'postgres') as 'postgres') || 'postgres',
  },
  jwt: {
    secret: getEnv('JWT_SECRET') || '',
    expiry: getEnv('JWT_EXPIRY', '24h') || '24h',
  },
  authCookie: {
    name: getEnv('AUTH_COOKIE_NAME', 'aquasense_session') || 'aquasense_session',
    secure: getEnv('AUTH_COOKIE_SECURE', nodeEnv === 'production' ? 'true' : 'false') === 'true',
    sameSite: (getEnv('AUTH_COOKIE_SAMESITE', nodeEnv === 'production' ? 'none' : 'lax') || 'lax') as
      | 'lax'
      | 'strict'
      | 'none',
    maxAgeMs: parseInt(getEnv('AUTH_COOKIE_MAX_AGE_MS', '86400000') || '86400000', 10),
  },
  device: {
    keys: parseDeviceKeys(getEnv('DEVICE_KEYS')),
    allowUnauthenticatedDevelopment: getEnv('ALLOW_UNAUTHENTICATED_DEVICES', 'false') === 'true',
  },
  sms: {
    provider: 'unisms',
    apiSecretKey: getOptionalCredential('UNISMS_API_SECRET_KEY'),
    senderId: getOptionalCredential('UNISMS_SENDER_ID'),
    maxMessageLength: parseInt(getEnv('SMS_MAX_MESSAGE_LENGTH', '160') || '160', 10),
    failureThreshold: parseInt(getEnv('SMS_FAILURE_THRESHOLD', '5') || '5', 10),
    circuitCooldownMs: parseInt(getEnv('SMS_CIRCUIT_COOLDOWN_MS', '60000') || '60000', 10),
  },
  mqtt: {
    brokerUrl: publicDevProfile
      ? (fileEnv.MQTT_BROKER_URL || 'mqtt://localhost:1883')
      : (getEnv('MQTT_BROKER_URL', 'mqtt://localhost:1883') || 'mqtt://localhost:1883'),
    publicTelemetryOnly: publicDevProfile,
    publicCommandsEnabled: publicDevProfile && fileEnv.MQTT_PUBLIC_COMMANDS_ENABLED === 'true',
    controlTopicNamespace: publicDevProfile
      ? (fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE || '')
      : (getEnv('MQTT_CONTROL_TOPIC_NAMESPACE') || 'aquasense'),
    topicNamespace: mqttNamespace,
    deviceScopedTopics: publicDevProfile && fileEnv.MQTT_DEVICE_SCOPED_TOPICS === 'true',
    controlBrokerUrl: publicDevProfile ? privateControlEnv.MQTT_BROKER_URL : undefined,
    controlUsername: publicDevProfile ? privateControlEnv.MQTT_USERNAME : undefined,
    controlPassword: publicDevProfile ? privateControlEnv.MQTT_PASSWORD : undefined,
    controlCaCertPath: publicDevProfile ? privateControlEnv.MQTT_CA_CERT_PATH : undefined,
    actuatorCommandsEnabled: publicDevProfile
      ? Boolean(fileEnv.MQTT_ACTUATOR_COMMANDS_ENABLED === 'true' &&
          ((fileEnv.MQTT_PUBLIC_COMMANDS_ENABLED === 'true' && isPublicHiveMqUrl(fileEnv.MQTT_BROKER_URL) &&
            parseDeviceKeys(fileEnv.DEVICE_KEYS)[telemetryDeviceId]?.length >= 32) ||
          (privateControlEnv.MQTT_BROKER_URL?.startsWith('mqtts://') &&
            !isPublicHiveMqUrl(privateControlEnv.MQTT_BROKER_URL) && privateControlEnv.MQTT_USERNAME &&
            privateControlEnv.MQTT_PASSWORD && privateControlEnv.MQTT_CA_CERT_PATH &&
            fs.existsSync(privateControlEnv.MQTT_CA_CERT_PATH) && parseDeviceKeys(fileEnv.DEVICE_KEYS)[telemetryDeviceId])))
      : getEnv('MQTT_ACTUATOR_COMMANDS_ENABLED', 'true') !== 'false',
    telemetryDeviceId,
    username: publicDevProfile ? undefined : getOptionalCredential('MQTT_USERNAME'),
    password: publicDevProfile ? undefined : getOptionalCredential('MQTT_PASSWORD'),
    topics: {
      readings: getEnv('MQTT_TOPIC_READINGS', 'water/esp32/readings') || 'water/esp32/readings',
      sensorWildcard: publicDevProfile
        ? `${mqttNamespace}/devices/${telemetryDeviceId}/telemetry/+`
        : (getEnv('MQTT_TOPIC_SENSOR_WILDCARD', 'aquasense/+') || 'aquasense/+'),
      commands: getEnv('MQTT_TOPIC_COMMANDS', 'water/commands/#') || 'water/commands/#',
      status: getEnv('MQTT_TOPIC_STATUS', 'water/esp32/status') || 'water/esp32/status',
    },
  },
  feeding: {
    deviceId: telemetryDeviceId,
    timezone: getEnv('FEEDING_TIMEZONE', 'Asia/Manila') || 'Asia/Manila',
  },
  farm: {
    farmerName: getEnv('FARMER_NAME', 'Farmer') || 'Farmer',
    farmName: getEnv('FARM_NAME', 'AquaSense Farm') || 'AquaSense Farm',
    tankName: getEnv('TANK_NAME'),
    recipientPhone: getEnv('FARMER_PHONE'),
  },
};

const configSchema = z.object({
  database: z.object({
    host: z.string().min(1, 'DB_HOST is required'),
    port: z.number().int().min(1).max(65535),
    name: z.string().min(1, 'DB_NAME is required'),
    user: z.string().min(1, 'DB_USER is required'),
    password: z.string().min(1, 'DB_PASSWORD is required'),
    dialect: z.literal('postgres'),
  }),
  jwt: z.object({
    secret: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  }),
  authCookie: z.object({
    name: z.string().min(1, 'AUTH_COOKIE_NAME is required'),
    sameSite: z.enum(['lax', 'strict', 'none']),
    maxAgeMs: z.number().int().min(60000),
  }),
  sms: z.object({
    provider: z.literal('unisms'),
    apiSecretKey: z.string().min(1).optional(),
    senderId: z.string().min(1).optional(),
    maxMessageLength: z.number().int().min(1).max(160),
    failureThreshold: z.number().int().min(1).max(20),
    circuitCooldownMs: z.number().int().min(1000).max(3600000),
  }),
  mqtt: z.object({
    brokerUrl: z.string().url('MQTT_BROKER_URL must be a valid URL'),
    username: z.string().min(1).optional(),
    password: z.string().min(1).optional(),
    topics: z.object({
      readings: z.string().min(1),
      sensorWildcard: z.string().min(1),
      commands: z.string().min(1),
      status: z.string().min(1),
    }),
    publicTelemetryOnly: z.boolean(),
    publicCommandsEnabled: z.boolean(),
    controlTopicNamespace: z.string().min(1),
    topicNamespace: z.string().min(1),
    deviceScopedTopics: z.boolean(),
    actuatorCommandsEnabled: z.boolean(),
    controlBrokerUrl: z.string().url().optional(),
    controlUsername: z.string().min(1).optional(),
    controlPassword: z.string().min(1).optional(),
    controlCaCertPath: z.string().min(1).optional(),
    telemetryDeviceId: z.string().min(1),
  }),
  feeding: z.object({
    deviceId: z.string().min(1),
    timezone: z.string().min(1),
  }),
});

export const validateConfiguration = (candidate: unknown, environment: string = config.server.nodeEnv): string[] => {
  const issues: string[] = [];
  const validated = configSchema.safeParse(candidate);
  if (!validated.success) issues.push(...validated.error.issues.map((issue) => issue.message));

  const candidateConfig = candidate as typeof config;
  if (candidateConfig.jwt?.secret && /<[^>]+>|replace-with|changeme|your_jwt_secret/i.test(candidateConfig.jwt.secret)) {
    issues.push('JWT_SECRET must not use a placeholder value');
  }
  if (candidateConfig.database?.password && /<[^>]+>|replace-with|changeme|your_database_password|your-local-database-password/i.test(candidateConfig.database.password)) {
    issues.push('DB_PASSWORD must use the actual local database password');
  }

  if (environment === 'production') {
    const productionConfig = candidateConfig;
    if (!productionConfig.jwt?.secret || /change_in_production|replace-with|changeme|your_jwt_secret/i.test(productionConfig.jwt.secret)) {
      issues.push('JWT_SECRET must be a strong non-placeholder secret in production');
    }
    if (!productionConfig.device?.keys || Object.keys(productionConfig.device.keys).length === 0) {
      issues.push('DEVICE_KEYS must include registered ESP32 device keys in production');
    }
    if (productionConfig.device?.keys && Object.values(productionConfig.device.keys).some((key) => /replace-with|changeme|your[-_]?device[-_]?key/i.test(key))) {
      issues.push('DEVICE_KEYS must not contain placeholder values in production');
    }
    if (productionConfig.authCookie?.secure !== true || productionConfig.authCookie?.sameSite !== 'none') {
      issues.push('AUTH_COOKIE_SECURE=true and AUTH_COOKIE_SAMESITE=none are required in production');
    }
    if (productionConfig.cors && Array.isArray(productionConfig.cors.origin) && productionConfig.cors.origin.some((origin) => origin.includes('localhost'))) {
      issues.push('CORS_ORIGIN must not use localhost in production');
    }
  }
  return issues;
};

const configurationIssues = validateConfiguration(config);
if (configurationIssues.length > 0) {
  throw new Error(`Invalid application configuration:\n- ${configurationIssues.join('\n- ')}`);
}
