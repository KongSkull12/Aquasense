import { Op } from 'sequelize';
import { HardwareCommand } from '../database/models/HardwareControl';
import { logger } from '../utils/logger';

// Temperature calibration is optional: the DS18B20 counts as calibrated without one.
export type CalibratedSensor = 'ph' | 'orp' | 'turbidity' | 'temperature';

const SAVED = /^saved n=\d+ slope=-?\d+(?:\.\d+)? offset=-?\d+(?:\.\d+)?$/;
const RESET = /^reset /;
const EMPTY: ReadonlySet<CalibratedSensor> = new Set();

const cache = new Map<string, Set<CalibratedSensor>>();
const loaded = new Set<string>();
const pending = new Map<string, Array<{ action: string; param: string | null | undefined; result: string | null | undefined }>>();
const inflight = new Map<string, Promise<ReadonlySet<CalibratedSensor>>>();

export function sensorFromCalibrationParam(param: string | null | undefined): CalibratedSensor | null {
  const sensor = param?.split(':')[0]?.trim().toLowerCase();
  if (sensor === 'ph' || sensor === 'orp') return sensor;
  if (sensor === 'turb') return 'turbidity';
  if (sensor === 'temp') return 'temperature';
  return null;
}

/** What a signed calibration acknowledgement changes. Serial-only edits never reach this. */
export function calibrationEffect(action: string, param: string | null | undefined, result: string | null | undefined): { sensor: CalibratedSensor; commissioned: boolean } | null {
  if (action !== 'CAL_CAPTURE' && action !== 'CAL_RESET') return null;
  const sensor = sensorFromCalibrationParam(param);
  if (!sensor) return null;
  if (action === 'CAL_RESET' || (result != null && RESET.test(result))) return { sensor, commissioned: false };
  if (action === 'CAL_CAPTURE' && result != null && SAVED.test(result)) return { sensor, commissioned: true };
  return null;
}

function apply(deviceId: string, action: string, param: string | null | undefined, result: string | null | undefined): void {
  const effect = calibrationEffect(action, param, result);
  if (!effect) return;
  let set = cache.get(deviceId);
  if (!set) { set = new Set(); cache.set(deviceId, set); }
  if (effect.commissioned) set.add(effect.sensor);
  else set.delete(effect.sensor);
}

/** Record a signed acknowledgement. Rows saved before the cache is loaded are replayed from the database. */
export function noteCalibrationResult(deviceId: string, action: string, param: string | null | undefined, result: string | null | undefined): void {
  if (!calibrationEffect(action, param, result)) return;
  if (loaded.has(deviceId)) { apply(deviceId, action, param, result); return; }
  const queued = pending.get(deviceId) ?? [];
  queued.push({ action, param, result });
  pending.set(deviceId, queued);
}

export function commissionedSensors(deviceId: string): Promise<ReadonlySet<CalibratedSensor>> {
  if (loaded.has(deviceId)) return Promise.resolve(cache.get(deviceId) ?? EMPTY);
  const existing = inflight.get(deviceId);
  if (existing) return existing;
  const work = loadCommissioned(deviceId).finally(() => inflight.delete(deviceId));
  inflight.set(deviceId, work);
  return work;
}

async function loadCommissioned(deviceId: string): Promise<ReadonlySet<CalibratedSensor>> {
  if (!HardwareCommand.sequelize) return cache.get(deviceId) ?? EMPTY;
  try {
    const rows = await HardwareCommand.findAll({
      where: { deviceId, status: 'ACKED', action: { [Op.in]: ['CAL_CAPTURE', 'CAL_RESET'] } },
      order: [['createdAt', 'ASC']],
    });
    cache.set(deviceId, new Set());
    for (const row of rows) apply(deviceId, row.action, row.param, row.result);
    loaded.add(deviceId);
    for (const item of pending.get(deviceId) ?? []) apply(deviceId, item.action, item.param, item.result);
    pending.delete(deviceId);
  } catch (error) {
    logger.warn('Could not load device calibration records', { deviceId, error: String(error) });
  }
  return cache.get(deviceId) ?? EMPTY;
}
