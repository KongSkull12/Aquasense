import assert from 'node:assert/strict';
import test, { afterEach, mock } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { canManageSubAccounts, isSubAccountRole, STAFF_HARDWARE_ACTIONS, subAccountRoleFor } from './userRoles';
import { listAccessibleDevices, verifyDeviceAccess } from './deviceAccess';
import { resolveSocketDeviceScope } from '../websocket/waterQualityWS';
import { mockDeviceAccess, type TestDevice, type TestUser } from './deviceAccessTestDoubles';

afterEach(() => { mock.restoreAll(); });

test('staff hardware allow-list covers drain, fill, fill-to-target, exchange, stop, and the aerator only', () => {
  assert.equal(STAFF_HARDWARE_ACTIONS.has('DRAIN'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('FILL'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('FILL_TO_TARGET'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('WATER_EXCHANGE'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('WATER_STOP'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('AERATOR_ON'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('AERATOR_OFF'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('AERATOR_AUTO'), true);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('AUTOMATION_ON'), false);
  assert.equal(STAFF_HARDWARE_ACTIONS.has('CAL_PH_MID'), false);
});

test('viewer accounts are stored as the read-only guest role', () => {
  assert.equal(subAccountRoleFor('viewer'), 'guest');
  assert.equal(subAccountRoleFor('staff'), 'staff');
  assert.equal(subAccountRoleFor(undefined), 'staff');
  assert.equal(isSubAccountRole('guest'), true);
  assert.equal(isSubAccountRole('farmer'), false);
  assert.equal(canManageSubAccounts('farmer'), true);
  assert.equal(canManageSubAccounts('admin'), true);
  assert.equal(canManageSubAccounts('staff'), false);
  assert.equal(canManageSubAccounts('guest'), false);
});

const users: TestUser[] = [
  { id: 'owner', role: 'farmer' },
  { id: 'other', role: 'farmer' },
  { id: 'viewer', role: 'guest', employerUserId: 'owner' },
  { id: 'lone-guest', role: 'guest' },
];
const devices: TestDevice[] = [
  { deviceId: 'esp32-feeder-1', userId: 'owner', isActive: true },
  { deviceId: 'other-tank', userId: 'other', isActive: true },
  { deviceId: 'guest-own', userId: 'lone-guest', isActive: true },
];

test('a viewer sees only the owner tank, over HTTP and the live socket', async () => {
  mockDeviceAccess(users, devices);
  assert.deepEqual((await listAccessibleDevices('viewer', 'guest')).map((d) => d.deviceId), ['esp32-feeder-1']);
  assert.equal(await verifyDeviceAccess('viewer', 'esp32-feeder-1', 'guest'), true);
  assert.equal(await verifyDeviceAccess('viewer', 'other-tank', 'guest'), false);
  const scope = await resolveSocketDeviceScope({ userId: 'viewer', role: 'guest' }, async () => []);
  assert.deepEqual(scope, ['esp32-feeder-1']);
});

test('a guest without an owner keeps seeing only its own devices', async () => {
  mockDeviceAccess(users, devices);
  assert.deepEqual((await listAccessibleDevices('lone-guest', 'guest')).map((d) => d.deviceId), ['guest-own']);
});

test('no write route lets a viewer (guest) in', () => {
  const roots = [path.join(__dirname, '../api/v1/routes'), path.join(__dirname, '../iot/water')];
  const offenders: string[] = [];
  let checked = 0;
  for (const dir of roots) {
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.ts') && !name.includes('.test.'))) {
      const source = readFileSync(path.join(dir, file), 'utf8');
      for (const line of source.split(/\r?\n/)) {
        const match = /^\s*router\.(post|put|patch|delete)\(\s*'([^']+)'.*requireRole\(\[([^\]]*)\]\)/.exec(line);
        if (!match) continue;
        checked += 1;
        if (/'guest'/.test(match[3])) offenders.push(`${file} ${match[1].toUpperCase()} ${match[2]}`);
      }
    }
  }
  assert.ok(checked >= 15, `expected to check the write routes, checked ${checked}`);
  assert.deepEqual(offenders, []);
});
