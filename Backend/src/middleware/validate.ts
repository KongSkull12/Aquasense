import { NextFunction, Request, Response } from 'express';
import { z, ZodSchema } from 'zod';
import { sendError } from '../utils/response';

export const validateBody = <T>(schema: ZodSchema<T>) => (req: Request, res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.body);
  if (!result.success) {
    sendError(res, 400, `Validation failed: ${result.error.issues.map((i) => i.message).join(', ')}`);
    return;
  }
  req.body = result.data;
  next();
};

export const validateQuery = <T>(schema: ZodSchema<T>) => (req: Request, res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.query);
  if (!result.success) {
    sendError(res, 400, `Invalid query parameters: ${result.error.issues.map((i) => i.message).join(', ')}`);
    return;
  }
  req.query = result.data as Request['query'];
  next();
};

export const validateParams = <T>(schema: ZodSchema<T>) => (req: Request, res: Response, next: NextFunction): void => {
  const result = schema.safeParse(req.params);
  if (!result.success) {
    sendError(res, 400, `Invalid path parameters: ${result.error.issues.map((i) => i.message).join(', ')}`);
    return;
  }
  next();
};

export const feedingScheduleSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/),
  enabled: z.boolean().optional(),
  label: z.string().trim().max(120).nullable().optional(),
});

export const feedingScheduleUpdateSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  time: z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/).optional(),
  enabled: z.boolean().optional(),
  label: z.string().trim().max(120).nullable().optional(),
});

export const feedingManualSchema = z.object({
  action: z.enum(['ON', 'OFF', 'TRIGGER']),
  deviceId: z.string().trim().min(1).max(120).optional(),
});

// Keep malformed sensor fields intact for structured diagnostics; never coerce null to zero.
// Sensor diagnostics intentionally preserve malformed non-numeric values for the
// health pipeline; numeric NaN/Infinity are rejected at the transport boundary.
const finiteSensorValue = z.any().refine((value) => typeof value !== 'number' || Number.isFinite(value), 'numeric values must be finite').optional();
const tanMeasurementSchema = z.object({
  value: z.number().finite().nonnegative(),
  unit: z.literal('mg/L as N'),
  source: z.enum(['test_kit', 'laboratory', 'external_sensor', 'manual']),
  validated: z.literal(true),
  timestamp: z.union([z.string().datetime({ offset: true }), z.number().finite()]),
}).strict();
const diagnosticPayload = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
  location: z.string().trim().max(255).optional(),
  temperature: finiteSensorValue, ph: finiteSensorValue,
  do: finiteSensorValue, dissolvedOxygen: finiteSensorValue,
  turbidity: finiteSensorValue, orp: finiteSensorValue, ammonia: finiteSensorValue,
  doMeasured: z.boolean().optional(),
  turbidityUnit: z.enum(['NTU', 'raw_adc']).optional(),
  timestamp: z.union([z.string().datetime({ offset: true }), z.number().finite()]).optional(),
  acquiredAt: z.union([z.string().datetime({ offset: true }), z.number().finite()]).optional(),
  sampleAgeMs: z.number().finite().min(0).max(86_400_000).optional(),
  bootId: z.string().trim().min(1).max(64).optional(), sequence: z.number().int().nonnegative().optional(),
  tan: tanMeasurementSchema.optional(), waterType: z.string().trim().max(32).optional(),
  sensorTimestamps: z.record(z.union([z.string().datetime({ offset: true }), z.number().finite()])).optional(),
  sensors: z.record(z.object({ sampleAgeMs: z.number().finite().min(0).max(86_400_000).optional() }).passthrough()).optional(),
}).passthrough();
export const sensorIngestSchema = diagnosticPayload.extend({deviceId:z.string().trim().min(1).max(120)});
export const waterReadingSchema = diagnosticPayload;

export const tanMeasurementEntrySchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  value: z.number().finite().nonnegative(),
  source: z.enum(['test_kit', 'laboratory', 'external_sensor', 'manual']),
  sampleCollectedAt: z.string().datetime({ offset: true }),
  validationEvidence: z.string().trim().min(8).max(2000),
  attestMeasurement: z.literal(true),
}).strict();

export const tanMeasurementQuerySchema = z.object({
  deviceId: z.string().trim().min(1).max(120).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

export const registerDeviceSchema = z.object({
  deviceId: z.string().trim().min(3).max(120),
  name: z.string().trim().min(2).max(120).optional(),
});

export const smsTestSchema = z.object({
  recipient: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
  message: z.string().trim().min(1).max(160).optional(),
});

const finiteNumber = z.number().finite();

export const thresholdSchema = z.object({
  temperature: z.object({
    min: finiteNumber,
    max: finiteNumber,
    warning: finiteNumber,
  }).strict(),
  ph: z.object({
    min: finiteNumber,
    max: finiteNumber,
    optimal: z.object({ min: finiteNumber, max: finiteNumber }).strict(),
  }).strict(),
  do: z.object({
    min: finiteNumber,
    critical: finiteNumber,
    optimal: finiteNumber,
  }).strict(),
  turbidity: z.object({
    max: finiteNumber,
    warning: finiteNumber,
  }).strict(),
}).strict().superRefine((value, context) => {
  const checks: Array<[boolean, string, string]> = [
    [value.temperature.min < value.temperature.max, 'temperature.min', 'must be less than temperature.max'],
    [value.temperature.warning <= value.temperature.max, 'temperature.warning', 'must not exceed temperature.max'],
    [value.ph.min < value.ph.max, 'ph.min', 'must be less than ph.max'],
    [value.ph.optimal.min <= value.ph.optimal.max, 'ph.optimal.min', 'must not exceed ph.optimal.max'],
    [value.do.critical <= value.do.min, 'do.critical', 'must not exceed do.min'],
    [value.do.min <= value.do.optimal, 'do.min', 'must not exceed do.optimal'],
    [value.turbidity.warning <= value.turbidity.max, 'turbidity.warning', 'must not exceed turbidity.max'],
  ];
  for (const [valid, path, message] of checks) {
    if (!valid) context.addIssue({ code: z.ZodIssueCode.custom, path: path.split('.'), message });
  }
});
export const thresholdPatchSchema = z.object({
  temperature: z.object({ min: finiteNumber.optional(), max: finiteNumber.optional(), warning: finiteNumber.optional() }).strict().optional(),
  ph: z.object({ min: finiteNumber.optional(), max: finiteNumber.optional(), optimal: z.object({ min: finiteNumber.optional(), max: finiteNumber.optional() }).strict().optional() }).strict().optional(),
  do: z.object({ min: finiteNumber.optional(), critical: finiteNumber.optional(), optimal: finiteNumber.optional() }).strict().optional(),
  turbidity: z.object({ max: finiteNumber.optional(), warning: finiteNumber.optional() }).strict().optional(),
}).strict();

export const sensorIdParamSchema = z.object({ id: z.string().uuid() });
export const scheduleIdParamSchema = z.object({ id: z.string().uuid() });
export const idParamSchema = sensorIdParamSchema;
export const deviceIdParamSchema = z.object({ deviceId: z.string().trim().min(1).max(120) });

export const sensorQuerySchema = z.object({
  minutes: z.coerce.number().int().min(1).max(1440).default(60),
  limit: z.coerce.number().int().min(1).max(200).default(50),
}).partial();

export const alertQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['ACTIVE', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
}).strict();
export const timeRangeQuerySchema = z.object({ minutes: z.coerce.number().int().min(1).max(1440).default(60) }).strict();
export const limitQuerySchema = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) }).strict();

export const feedingDeviceAckSchema = z.object({
  deviceId: z.string().trim().min(1).max(120),
  commandId: z.string().uuid(),
  result: z.string().trim().min(1).max(64).optional(),
}).strict();
export const feedingDeviceSyncSchema = z.object({ deviceId: z.string().trim().min(1).max(120) }).strict();
