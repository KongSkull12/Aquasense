import test from 'node:test';
import assert from 'node:assert/strict';
import { commandCanonical, hardwareCommandSchema, parseSignedCommand, signCanonical, verifyCanonical } from './hardwareProtocol';

const base = { v: 1 as const, deviceId: 'esp32-feeder-1', id: '6f1c2a4e-3b5d-4c7e-9f10-2a3b4c5d6e7f', source: 'hardware' as const,
  action: 'FILL', durationMs: 5000, expiresAt: 1800000000000 };

test('commands without a param keep the original canonical form', () => {
  assert.equal(commandCanonical(base), 'v1|esp32-feeder-1|6f1c2a4e-3b5d-4c7e-9f10-2a3b4c5d6e7f|hardware|FILL|5000|1800000000000');
});

test('the calibration param is part of the signed canonical form', () => {
  const command = { ...base, action: 'CAL_CAPTURE', durationMs: 0, param: 'ph:6.86' };
  assert.equal(commandCanonical(command), 'v1|esp32-feeder-1|6f1c2a4e-3b5d-4c7e-9f10-2a3b4c5d6e7f|hardware|CAL_CAPTURE|0|1800000000000|ph:6.86');
  const key = 'k'.repeat(64);
  const signature = signCanonical(commandCanonical(command), key);
  assert.equal(verifyCanonical(commandCanonical({ ...command, param: 'ph:4.01' }), signature, key), false);
  assert.ok(parseSignedCommand({ ...command, signature }));
});

test('calibration commands validate their param', () => {
  const ok = (body: unknown) => hardwareCommandSchema.safeParse(body).success;
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'ph:6.86' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'ORP:-225.5' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'turb:100' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'ph' }), false);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE' }), false);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'temp:28.4' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_RESET', param: 'temp' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_CAPTURE', param: 'do:7' }), false);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_STATUS', param: 'orp' }), true);
  assert.equal(ok({ deviceId: 'd', action: 'CAL_RESET', param: 'ph:7' }), false);
  assert.equal(ok({ deviceId: 'd', action: 'FILL', durationMs: 5000, param: 'ph' }), false);
});
