import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrationEffect } from './deviceCalibration';

test('a saved ORP capture is commissioned and a reset clears it', () => {
  const saved = calibrationEffect('CAL_CAPTURE', 'orp:225', 'saved n=1 slope=1333.32996 offset=-2038.3469');
  assert.deepEqual(saved, { sensor: 'orp', commissioned: true });
  assert.equal(calibrationEffect('CAL_RESET', 'orp', 'reset n=0 slope=1333.32996 offset=-2000.0000')?.commissioned, false);
});

test('a single pH point and a device status reply do not commission a sensor', () => {
  assert.equal(calibrationEffect('CAL_CAPTURE', 'ph:6.86', 'recorded n=1 x=1.7200'), null);
  assert.equal(calibrationEffect('CAL_STATUS', 'orp', 'status n=1 slope=1333.32996 offset=-2038.3469'), null);
  assert.equal(calibrationEffect('CAL_CAPTURE', 'turb:0', 'saved n=1 slope=-0.40000 offset=1200.0000')?.sensor, 'turbidity');
});
