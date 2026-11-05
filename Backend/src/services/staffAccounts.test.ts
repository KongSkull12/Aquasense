import assert from 'node:assert/strict';
import test from 'node:test';
import { STAFF_HARDWARE_ACTIONS } from './userRoles';

test('staff hardware allow-list covers drain, fill, fill-to-target, exchange, and stop only', () => {
  assert.equal(STAFF_HARDWARE_ACTIONS.has('DRAIN'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('FILL'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('FILL_TO_TARGET'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('WATER_EXCHANGE'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('WATER_STOP'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('AERATOR_ON'), false);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('CAL_PH_MID'), false);
});
