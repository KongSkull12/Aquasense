import test, { mock, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { tokenService } from '../utils/tokenService';
import { getSessionTokenFromCookieHeader, resolveSocketDeviceScope, resolveSocketSession } from '../websocket/waterQualityWS';
import { mockDeviceAccess } from './deviceAccessTestDoubles';

afterEach(() => mock.restoreAll());

test('Socket.IO session extraction accepts only a verified auth cookie', () => {
  mock.method(tokenService, 'verifyToken', (token: string) => token === 'valid-session'
    ? { userId: 'owner-a', email: 'owner@example.test', role: 'farmer' as const }
    : null);

  assert.equal(getSessionTokenFromCookieHeader(undefined, 'aquasense_session'), null);
  assert.equal(getSessionTokenFromCookieHeader('other=value', 'aquasense_session'), null);
  assert.equal(getSessionTokenFromCookieHeader('aquasense_session=%E0%A4%A', 'aquasense_session'), null);
  assert.equal(resolveSocketSession('aquasense_session=expired-session', 'aquasense_session'), null);
  assert.equal(resolveSocketSession('aquasense_session=revoked-session', 'aquasense_session'), null);
  assert.deepEqual(resolveSocketSession('other=x; aquasense_session=valid-session', 'aquasense_session'), {
    token: 'valid-session', userId: 'owner-a', role: 'farmer',
  });
});

test('Socket.IO history and live-data scope includes only active devices owned by the session', async () => {
  const listDevices = async (userId: string) => userId === 'owner-a'
    ? [{ deviceId: 'device-a', isActive: true }, { deviceId: 'device-old', isActive: false }]
    : [{ deviceId: 'device-b', isActive: true }];
  assert.deepEqual(await resolveSocketDeviceScope({ userId: 'owner-a', role: 'farmer' }, listDevices), ['device-a']);
  // Guests go through deviceAccess (a viewer may belong to an owner); one without an owner sees its own active devices.
  mockDeviceAccess([{ id: 'owner-b', role: 'guest' }], [
    { deviceId: 'device-b', userId: 'owner-b', isActive: true },
    { deviceId: 'device-b-old', userId: 'owner-b', isActive: false },
    { deviceId: 'device-a', userId: 'owner-a', isActive: true },
  ]);
  assert.deepEqual(await resolveSocketDeviceScope({ userId: 'owner-b', role: 'guest' }, listDevices), ['device-b']);
  assert.equal(await resolveSocketDeviceScope({ userId: 'admin', role: 'admin' }, listDevices), undefined);
});
