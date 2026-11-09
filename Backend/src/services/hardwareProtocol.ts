import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const hardwareActions = ['FILL', 'DRAIN', 'WATER_EXCHANGE', 'FILL_TO_TARGET', 'WATER_STOP', 'AERATOR_ON',
  'AERATOR_OFF', 'AERATOR_AUTO', 'AUTOMATION_ON', 'AUTOMATION_OFF', 'BUZZER_ON',
  'BUZZER_OFF', 'ALL_OFF', 'CLEAR_FAULT',
  'CAL_CAPTURE', 'CAL_CLEAR', 'CAL_RESET', 'CAL_STATUS'] as const;
export type HardwareAction = typeof hardwareActions[number];
export const calibrationActions: readonly HardwareAction[] = ['CAL_CAPTURE', 'CAL_CLEAR', 'CAL_RESET', 'CAL_STATUS'];
// Calibration commands carry "<sensor>" or, for a capture, "<sensor>:<reference>" (e.g. "ph:6.86").
// Tank depth: "tank:empty" captures mount height; "tank:target:<cm>" sets the desired water column.
const calibrationSensorParam = /^(ph|orp|turb|temp|tank)$/;
const calibrationCaptureParam = /^(?:(?:ph|orp|turb|temp):-?\d{1,4}(?:\.\d{1,3})?|tank:empty|tank:target:\d{1,3}(?:\.\d{1,3})?)$/;
export const COMMAND_TTL_MS = 120_000;
export const DEVICE_ONLINE_MS = 45_000;
export const MAX_PUMP_RUNTIME_MS = 600_000; // Keep aligned with firmware PUMP_HARD_MAX_MS (10 min).
const deviceId = z.string().trim().min(1).max(120);
export const hardwareCommandSchema = z.object({ deviceId, action: z.enum(hardwareActions),
  durationMs: z.number().int().min(1).max(MAX_PUMP_RUNTIME_MS).optional(),
  param: z.string().trim().toLowerCase().max(24).optional() }).strict().superRefine((value, context) => {
  const timedPump = ['FILL', 'DRAIN', 'WATER_EXCHANGE'].includes(value.action);
  const fillToTarget = value.action === 'FILL_TO_TARGET';
  if (timedPump && value.durationMs === undefined) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'durationMs is required only for pump commands (per phase for an exchange)' });
  if (!timedPump && !fillToTarget && value.durationMs !== undefined) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'durationMs is required only for pump commands (per phase for an exchange)' });
  const calibration = calibrationActions.includes(value.action);
  if (!calibration && value.param !== undefined) context.addIssue({ code: z.ZodIssueCode.custom,
    message: 'param is only used by calibration commands' });
  if (calibration) {
    const pattern = value.action === 'CAL_CAPTURE' ? calibrationCaptureParam : calibrationSensorParam;
    if (value.param === undefined || !pattern.test(value.param)) context.addIssue({ code: z.ZodIssueCode.custom,
      message: value.action === 'CAL_CAPTURE'
        ? 'param must be "<ph|orp|turb|temp>:<reference>", "tank:empty", or "tank:target:<cm>"'
        : 'param must be the sensor: "ph", "orp", "turb", "temp" or "tank"' });
  }
});
export const hardwareStateSchema = z.object({
  fillPump: z.boolean(), drainPump: z.boolean(), aerator: z.boolean(),
  feederBusy: z.boolean(), buzzer: z.boolean(), automation: z.boolean(),
  // Optional so a sketch flashed before this field still verifies. Present sketches sign it.
  aeratorAuto: z.boolean().optional(),
  waterPhase: z.enum(['IDLE', 'DRAINING', 'SETTLING_AFTER_DRAIN', 'REFILLING', 'COOLDOWN', 'COMPLETE', 'FAULT']),
  fault: z.string().max(64), relaysReady: z.boolean(), timeValid: z.boolean(),
  wifiConnected: z.boolean(), mqttConnected: z.boolean(),
  uptimeMs: z.number().int().min(0).max(0xffffffff),
  // Display-only countdown; not part of the signed ACK canonical.
  phaseRemainingMs: z.number().int().min(0).max(MAX_PUMP_RUNTIME_MS).optional(),
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
  expiresAt: z.number().int().positive(), param: z.string().max(24).optional(),
  signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export const signedAckSchema = z.object({ v: z.literal(1), deviceId, id: z.string().uuid(),
  source: z.enum(['hardware', 'feeding']), action: z.string().min(1).max(32), result: z.string().min(1).max(64),
  reportedAt: z.number().int().positive(), state: hardwareStateSchema,
  signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export type HardwareState = z.infer<typeof hardwareStateSchema>;
export type CommandReceipt = z.infer<typeof receiptSchema>;
export type SignedHardwareAck = z.infer<typeof signedAckSchema>;
export type SignedHardwareCommand = z.infer<typeof signedCommandFields>;

const bit = (value: boolean): number => value ? 1 : 0;
// The optional param is appended only when present, so commands without one keep
// the original canonical form (and older firmware keeps verifying them).
export const commandCanonical = (value: Omit<SignedHardwareCommand, 'signature'>): string =>
  `v1|${value.deviceId}|${value.id}|${value.source}|${value.action}|${value.durationMs}|${value.expiresAt}` +
  (value.param !== undefined ? `|${value.param}` : '');
export const ackCanonical = (value: Omit<SignedHardwareAck, 'signature'>): string => {
  const state = value.state;
  const signed = `v1|${value.deviceId}|${value.id}|${value.source}|${value.action}|${value.result}|${value.reportedAt}|${bit(state.fillPump)}|${bit(state.drainPump)}|${bit(state.aerator)}|${bit(state.feederBusy)}|${bit(state.buzzer)}|${bit(state.automation)}|${state.waterPhase}|${state.fault}|${bit(state.relaysReady)}|${bit(state.timeValid)}|${bit(state.wifiConnected)}|${bit(state.mqttConnected)}|${state.uptimeMs}`;
  return state.aeratorAuto === undefined ? signed : `${signed}|${bit(state.aeratorAuto)}`;
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
