import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { Device } from '../database/models/Device';
import { deviceService } from './device.service';
import deviceRoutes from '../api/v1/routes/devices';
import { tokenService } from '../utils/tokenService';
import { auditLogService } from './auditLog.service';
import { csrfProtection } from '../middleware/csrfProtection';

afterEach(() => mock.restoreAll());

test('registration creates an active device for the authenticated owner', async () => {
  const create = mock.method(Device, 'create', async (values: any) => ({ ...values, createdAt: new Date() } as any));
  mock.method(Device, 'findOne', async () => null);

  const device = await deviceService.registerDevice('owner-a', 'esp32-feeder-1', 'Main Tank');

  assert.equal(device.userId, 'owner-a');
  assert.equal(device.deviceId, 'esp32-feeder-1');
  assert.equal(device.isActive, true);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(create.mock.calls[0].arguments[0], {
    userId: 'owner-a', deviceId: 'esp32-feeder-1', name: 'Main Tank', isActive: true,
  });
});

test('the same owner can reactivate their inactive device without creating a duplicate', async () => {
  const existing: any = { userId: 'owner-a', deviceId: 'esp32-feeder-1', name: 'Old name', isActive: false, save: mock.fn(async () => undefined) };
  mock.method(Device, 'findOne', async () => existing);
  const create = mock.method(Device, 'create', async () => { throw new Error('must not create a duplicate'); });

  const device = await deviceService.registerDevice('owner-a', 'esp32-feeder-1', 'Main Tank');

  assert.equal(device, existing);
  assert.equal(existing.isActive, true);
  assert.equal(existing.name, 'Main Tank');
  assert.equal(existing.save.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 0);
});

test('a device already owned by another account cannot be claimed', async () => {
  mock.method(Device, 'findOne', async () => ({ userId: 'owner-a', deviceId: 'esp32-feeder-1', isActive: true } as any));
  const create = mock.method(Device, 'create', async () => { throw new Error('must not create'); });

  await assert.rejects(deviceService.registerDevice('owner-b', 'esp32-feeder-1'), /already registered to another user/);
  assert.equal(create.mock.callCount(), 0);
});

test('device retrieval is scoped to the requesting account and newest registrations first', async () => {
  const findAll = mock.method(Device, 'findAll', async () => [] as any);

  await deviceService.listByUser('owner-a');

  assert.deepEqual(findAll.mock.calls[0].arguments[0], {
    where: { userId: 'owner-a' }, order: [['createdAt', 'DESC']],
  });
});

test('TAN eligibility ownership check requires the matching active device', async () => {
  const findOne = mock.method(Device, 'findOne', async () => ({ id: 'owned' } as any));

  assert.equal(await deviceService.verifyOwnership('owner-a', 'esp32-feeder-1'), true);
  assert.deepEqual(findOne.mock.calls[0].arguments[0], {
    where: { userId: 'owner-a', deviceId: 'esp32-feeder-1', isActive: true },
  });
});

test('authenticated device API registers and retrieves only the caller-owned device', async () => {
  // In-memory API fixture only; no production database rows or hardware identity are created.
  const records: any[] = [];
  mock.method(tokenService, 'verifyToken', (token: string) => token === 'owner-a-token'
    ? { userId: 'owner-a', email: 'owner-a@example.test', role: 'farmer' }
    : token === 'owner-b-token' ? { userId: 'owner-b', email: 'owner-b@example.test', role: 'farmer' } : null);
  mock.method(deviceService, 'registerDevice', async (userId: string, id: string, name?: string) => {
    const current = records.find((item) => item.deviceId === id);
    if (current && current.userId !== userId) throw new Error('Device ID is already registered to another user');
    if (current) { current.isActive = true; return current; }
    const created = { userId, deviceId: id, name: name || `Device ${id}`, isActive: true, createdAt: new Date().toISOString() };
    records.push(created);
    return created as any;
  });
  mock.method(deviceService, 'listByUser', async (userId: string) => records.filter((item) => item.userId === userId) as any);
  mock.method(auditLogService, 'createLog', async () => null);

  const app = express();
  app.use(express.json(), csrfProtection, deviceRoutes);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const request = (method: string, path: string, token?: string, body?: unknown) => fetch(base + path, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  try {
    assert.equal((await request('GET', '/devices')).status, 401);
    assert.equal((await request('POST', '/devices', undefined, { deviceId: 'esp32-feeder-1' })).status, 401);

    const registration = await request('POST', '/devices', 'owner-a-token', { deviceId: 'esp32-feeder-1', name: 'Main Tank' });
    assert.equal(registration.status, 201);
    const list = await request('GET', '/devices', 'owner-a-token');
    assert.equal(list.status, 200);
    const payload = await list.json() as { data: Array<{ deviceId: string; isActive: boolean }> };
    assert.deepEqual(payload.data.map(({ deviceId, isActive }) => ({ deviceId, isActive })), [{ deviceId: 'esp32-feeder-1', isActive: true }]);

    const otherOwnerList = await request('GET', '/devices', 'owner-b-token');
    const otherPayload = await otherOwnerList.json() as { data: unknown[] };
    assert.deepEqual(otherPayload.data, []);
    assert.equal((await request('POST', '/devices', 'owner-b-token', { deviceId: 'esp32-feeder-1' })).status, 400);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
