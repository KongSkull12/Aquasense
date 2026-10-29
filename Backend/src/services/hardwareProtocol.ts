import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const hardwareActions = ['FILL', 'DRAIN', 'WATER_EXCHANGE', 'WATER_STOP', 'AERATOR_ON',
  'AERATOR_OFF', 'AERATOR_AUTO', 'AUTOMATION_ON', 'AUTOMATION_OFF', 'BUZZER_ON',
  'BUZZER_OFF', 'ALL_OFF', 'CLEAR_FAULT'] as const;
export type HardwareAction = typeof hardwareActions[number];
export const COMMAND_TTL_MS = 120_000;
export const DEVICE_ONLINE_MS = 20_000;
export const MAX_PUMP_RUNTIME_MS = 60_000; // Keep aligned with the firmware commissioning cap.
const deviceId = z.string().trim().min(1).max(120);
export const hardwareCommandSchema = z.object({ deviceId, action: z.enum(hardwareActions),
  durationMs: z.number().int().min(1).max(MAX_PUMP_RUNTIME_MS).optional() }).strict().superRefine((value, context) => {
  const pump = ['FILL', 'DRAIN', 'WATER_EXCHANGE'].includes(value.action);
  if (pump !== (value.durationMs !== undefined)) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'durationMs is required only for pump commands (per phase for an exchange)' });
});
export const hardwareStateSchema = z.object({
  fillPump: z.boolean(), drainPump: z.boolean(), aerator: z.boolean(),
  feederBusy: z.boolean(), buzzer: z.boolean(), automation: z.boolean(),
  waterPhase: z.enum(['IDLE', 'DRAINING', 'SETTLING_AFTER_DRAIN', 'REFILLING', 'COOLDOWN', 'COMPLETE', 'FAULT']),
  fault: z.string().max(64), relaysReady: z.boolean(), timeValid: z.boolean(),
  wifiConnected: z.boolean(), mqttConnected: z.boolean(),
  uptimeMs: z.number().int().min(0).max(0xffffffff),
}).strict().superRefine((value, context) => {
  if (value.fillPump && value.drainPump) context.addIssue({ code: z.ZodIssueCode.custom, message: 'Fill and drain cannot both be on' });
});
export const receiptSchema = z.object({
  id: z.string().uuid(), source: z.enum(['hardware', 'feeding']),
  result: z.string().min(1).max(64),
}).strict();
export const hardwareSyncSchema = z.object({ deviceId, state: hardwareStateSchema, receipt: receiptSchema.optional() }).strict();

const signedCommandFields = z.object({ v: z.literal(1), deviceId, id: z.string().uuid(),
  source: z.enum(['hardware', 'feeding']), action: z.string().min(1).max(32), durationMs: z.number().int().min(0),
  expiresAt: z.number().int().positive(), signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export const signedAckSchema = z.object({ v: z.literal(1), deviceId, id: z.string().uuid(),
  source: z.enum(['hardware', 'feeding']), action: z.string().min(1).max(32), result: z.string().min(1).max(64),
  reportedAt: z.number().int().positive(), state: hardwareStateSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type HardwareState = z.infer<typeof hardwareStateSchema>;
export type CommandReceipt = z.infer<typeof receiptSchema>;
export type SignedHardwareAck = z.infer<typeof signedAckSchema>;
export type SignedHardwareCommand = z.infer<typeof signedCommandFields>;

const bit = (value: boolean): number => value ? 1 : 0;
export const commandCanonical = (value: Omit<SignedHardwareCommand, 'signature'>): string =>
  `v1|${value.deviceId}|${value.id}|${value.source}|${value.action}|${value.durationMs}|${value.expiresAt}`;
export const ackCanonical = (value: Omit<SignedHardwareAck, 'signature'>): string => {
  const state = value.state;
  return `v1|${value.deviceId}|${value.id}|${value.source}|${value.action}|${value.result}|${value.reportedAt}|${bit(state.fillPump)}|${bit(state.drainPump)}|${bit(state.aerator)}|${bit(state.feederBusy)}|${bit(state.buzzer)}|${bit(state.automation)}|${state.waterPhase}|${state.fault}|${bit(state.relaysReady)}|${bit(state.timeValid)}|${bit(state.wifiConnected)}|${bit(state.mqttConnected)}|${state.uptimeMs}`;
};
export const signCanonical = (canonical: string, key: string): string => createHmac('sha256', key).update(canonical).digest('hex');
export const verifyCanonical = (canonical: string, signature: string, key: string): boolean => {
  const expected = Buffer.from(signCanonical(canonical, key), 'hex');
  const supplied = Buffer.from(signature, 'hex');
  return expected.length === supplied.length && timingSafeEqual(expected, supplied);
};
export const parseSignedAck = (raw: string): SignedHardwareAck | null => {
  try { const parsed = signedAckSchema.safeParse(JSON.parse(raw)); return parsed.success ? parsed.data : null; }
  catch { return null; }
};
export const parseSignedCommand = (value: unknown): SignedHardwareCommand | null => {
  const parsed = signedCommandFields.safeParse(value); return parsed.success ? parsed.data : null;
};
