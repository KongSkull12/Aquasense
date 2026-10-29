import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { TanMeasurement as TanModel } from '../database/models/TanMeasurement';
import { SensorReading as SensorModel } from '../database/models/SensorReading';
import { TanMeasurementService } from './tanMeasurement.service';
import { SensorValidator, SENSOR_NAMES, type HealthSummary } from './sensorHealth';
import { tanMeasurementEntrySchema } from '../middleware/validate';

afterEach(() => mock.restoreAll());
const service = new TanMeasurementService();
const collectedAt = Date.parse('2026-10-01T02:00:00.000Z');
const stamp = (at: number) => new Date(at).toISOString();

const qualifiedEnvironment = (sampleAt: number): HealthSummary => {
  const validator = new SensorValidator();
  return Object.fromEntries(SENSOR_NAMES.map((name) => {
    const rawValue = name === 'temperature' ? 25 : name === 'ph' ? 8 : name === 'turbidity' ? 30 : 150;
    const health = validator.validate('tank-1', name, rawValue, stamp(sampleAt), {}, sampleAt, name === 'turbidity' ? 'NTU' : undefined);
    return [name, name === 'temperature' || name === 'ph'
      ? { ...health, calibration: 'CALIBRATED', stability: 'STABLE' }
      : health];
  })) as HealthSummary;
};

const modelRow = (input: Record<string, unknown>) => ({
  ...input,
  id: 'tan-1',
  get: () => ({ ...input, id: 'tan-1' }),
});

const input = {
  deviceId: 'tank-1',
  value: 1,
  source: 'test_kit' as const,
  sampleCollectedAt: stamp(collectedAt),
  validationEvidence: 'Kit ACME lot 42, expiry 2027-04',
};

test('TAN entry keeps collection time separate from server entry time and handles delayed results', async () => {
  const stored: Record<string, unknown>[] = [];
  mock.method(TanModel, 'create', async (values: Record<string, unknown>) => {
    stored.push(values);
    return modelRow(values) as any;
  });
  mock.method(SensorModel, 'findAll', async () => [{
    id: 'water-1', sensorHealth: qualifiedEnvironment(collectedAt),
    get: () => ({ id: 'water-1', sensorHealth: qualifiedEnvironment(collectedAt) }),
  } as any]);

  const record = await service.record('user-1', input);
  assert.equal(stored[0].enteredByUserId, 'user-1');
  assert.equal(record.sampleCollectedAt.toISOString(), input.sampleCollectedAt);
  assert.ok(record.enteredAt.getTime() > record.sampleCollectedAt.getTime());
  assert.equal(record.value, 1);
  assert.equal(record.validationStatus, 'USER_ATTESTED');
  assert.equal(record.environmentalReadingId, 'water-1');
  assert.ok(Math.abs((record.nh3N ?? 0) - 0.05384) < 0.0001);
});

test('TAN remains recorded but NH3-N unavailable without a matching environmental sample', async () => {
  mock.method(TanModel, 'create', async (values: Record<string, unknown>) => modelRow(values) as any);
  mock.method(SensorModel, 'findAll', async () => []);
  const record = await service.record('user-1', input);
  assert.equal(record.value, 1);
  assert.equal(record.nh3N, null);
  assert.equal(record.speciationStatus, 'UNAVAILABLE');
  assert.match(record.speciationReason, /No pH and temperature readings/);
});

test('manual TAN entry rejects future sample time and strict transport requires evidence attestation', async () => {
  await assert.rejects(() => service.record('user-1', { ...input, sampleCollectedAt: stamp(Date.now() + 60_000) }), /cannot be in the future/);
  const valid = { ...input, attestMeasurement: true };
  assert.equal(tanMeasurementEntrySchema.safeParse(valid).success, true);
  assert.equal(tanMeasurementEntrySchema.safeParse({ ...valid, attestMeasurement: false }).success, false);
  assert.equal(tanMeasurementEntrySchema.safeParse({ ...valid, validationEvidence: '' }).success, false);
  assert.equal(tanMeasurementEntrySchema.safeParse({ ...valid, enteredByUserId: 'spoofed-user' }).success, false);
});

test('NH3-N stays unavailable when pH and temperature collection times are outside alignment tolerance', async () => {
  const health = qualifiedEnvironment(collectedAt);
  health.ph = { ...health.ph, timestamp: stamp(collectedAt + 20_000) };
  mock.method(TanModel, 'create', async (values: Record<string, unknown>) => modelRow(values) as any);
  mock.method(SensorModel, 'findAll', async () => [{
    id: 'water-unaligned', sensorHealth: health,
    get: () => ({ id: 'water-unaligned', sensorHealth: health }),
  } as any]);
  const record = await service.record('user-1', input);
  assert.equal(record.nh3N, null);
  assert.equal(record.speciationStatus, 'UNAVAILABLE');
  assert.match(record.speciationReason, /No pH and temperature readings/);
});
