import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import { Op } from 'sequelize';
import type { AddressInfo } from 'node:net';
import hardwareRoutes from '../api/v1/routes/hardware';
import feedingRoutes from '../api/v1/routes/feeding';
import { ackCanonical, commandCanonical, hardwareCommandSchema, hardwareStateSchema, hardwareSyncSchema, parseSignedAck, parseSignedCommand, signCanonical, verifyCanonical, type HardwareState } from './hardwareProtocol';
import { hardwareService } from './hardwareService';
import { HardwareCommand, HardwareDeviceState } from '../database/models/HardwareControl';
import { FeedingCommand } from '../database/models/FeedingCommand';
import * as database from '../database/connection';
import { feedingService } from './feedingService';
import { deviceService } from './device.service';
import { auditLogService } from './auditLog.service';
import { tokenService } from '../utils/tokenService';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { parseOrp, orpStatistics } from './sensorValues';
import { MQTTService } from './mqttService';
import { sensorReadingService } from './sensorReadingService';
import { waterAlertNotificationService } from './waterAlertNotification.service';
import { csrfProtection } from '../middleware/csrfProtection';

const originalKeys = config.device.keys;
afterEach(() => { mock.restoreAll(); config.device.keys = originalKeys; });
const id = '9f2f2cbb-5e87-4bb3-a95e-c45d05de97d1';
const mockSerializedDatabase = () => {
  let tail = Promise.resolve();
  mock.method(database, 'getDatabase', () => ({
    query: async () => [],
    transaction: async (work: (transaction: object) => Promise<unknown>) => {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>((resolve) => { release = resolve; });
      await previous;
      try { return await work({}); } finally { release(); }
    },
  } as any));
};
const state: HardwareState = { fillPump: false, drainPump: false, aerator: false, feederBusy: false,
  buzzer: false, automation: false, waterPhase: 'IDLE', fault: '', relaysReady: false, timeValid: false,
  wifiConnected: true, mqttConnected: true, uptimeMs: 123 };

test('pump commands require bounded integer timing; non-pump commands reject timing and extra fields', () => {
  for (const durationMs of [undefined, 0, -1, 1.5, 300001, '1000']) {
    assert.equal(hardwareCommandSchema.safeParse({ deviceId: 'board', action: 'FILL', durationMs }).success, false);
  }
  assert.equal(hardwareCommandSchema.safeParse({ deviceId: 'board', action: 'WATER_EXCHANGE', durationMs: 1000 }).success, true);
  assert.equal(hardwareCommandSchema.safeParse({ deviceId: 'board', action: 'ALL_OFF', durationMs: 1000 }).success, false);
  assert.equal(hardwareCommandSchema.safeParse({ deviceId: 'board', action: 'RAW_GPIO', pin: 25 }).success, false);
  assert.equal(hardwareSyncSchema.safeParse({ deviceId: 'board', state: { ...state, floatWet: true } }).success, false);
  assert.equal(hardwareStateSchema.safeParse({ ...state, waterPhase: 'TRANSITION' }).success, false);
});

test('hardware state accepts the explicit nonblocking water exchange phases', () => {
  for (const waterPhase of ['IDLE', 'DRAINING', 'SETTLING_AFTER_DRAIN', 'REFILLING', 'COOLDOWN', 'FAULT']) {
    assert.equal(hardwareSyncSchema.safeParse({ deviceId: 'board', state: { ...state, waterPhase } }).success, true);
  }
});

test('stop bypasses full queue and ALL_OFF cancels pending feeding starts', async () => {
  mockSerializedDatabase();
  mock.method(HardwareCommand, 'findOne', async () => null);
  const count = mock.method(HardwareCommand, 'count', async () => 20);
  const cancel = mock.method(HardwareCommand, 'update', async () => [20]);
  const cancelFeed = mock.method(FeedingCommand, 'update', async () => [1]);
  const create = mock.method(HardwareCommand, 'create', async (input: unknown) => input);
  await assert.rejects(hardwareService.queue('owner', 'board', 'FILL', 1000), /queue is full/);
  await hardwareService.queue('owner', 'board', 'ALL_OFF');
  assert.equal(count.mock.callCount(), 1);
  assert.equal(cancel.mock.callCount(), 1); assert.equal(cancelFeed.mock.callCount(), 1);
  assert.equal(create.mock.callCount(), 1);
  assert.deepEqual(cancel.mock.calls[0].arguments[1]?.where, { userId: 'owner', deviceId: 'board', status: 'PENDING' });
});

test('a stop cancels an earlier start, blocks concurrent starts until acknowledged, then permits a new start', async () => {
  mockSerializedDatabase();
  const rows: any[] = [];
  let nextId = 0;
  mock.method(HardwareCommand, 'create', async (values: any) => {
    const row: any = { ...values, id: `command-${++nextId}`, status: 'PENDING', result: null, createdAt: new Date(),
      async update(changes: any) { Object.assign(this, changes); } };
    rows.push(row);
    return row;
  });
  mock.method(HardwareCommand, 'count', async (options: any) => rows.filter((row) =>
    row.userId === options.where.userId && row.deviceId === options.where.deviceId && row.status === options.where.status &&
    row.expiresAt > options.where.expiresAt[Op.gt]).length);
  mock.method(HardwareCommand, 'findOne', async (options: any) => {
    const where = options?.where || {};
    const found = rows.filter((row) => (!where.id || row.id === where.id) &&
      (!where.userId || row.userId === where.userId) && (!where.deviceId || row.deviceId === where.deviceId) &&
      (!where.status || row.status === where.status) &&
      (!where.action?.[Op.in] || where.action[Op.in].includes(row.action)));
    return found.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] || null;
  });
  mock.method(HardwareCommand, 'update', async (changes: any, options: any) => {
    let changed = 0;
    for (const row of rows) {
      const where = options.where;
      if (row.userId !== where.userId || row.deviceId !== where.deviceId || row.status !== where.status) continue;
      if (where.expiresAt?.[Op.lte] && row.expiresAt > where.expiresAt[Op.lte]) continue;
      Object.assign(row, changes); changed++;
    }
    return [changed];
  });
  mock.method(FeedingCommand, 'update', async () => [0]);
  mock.method(FeedingCommand, 'findOne', async () => null);
  mock.method(HardwareDeviceState, 'upsert', async () => [state, true]);
  mock.method(feedingService, 'listSchedules', async () => []);

  await hardwareService.queue('owner', 'board', 'FILL', 1000);
  const [stopResult, startResult] = await Promise.allSettled([
    hardwareService.queue('owner', 'board', 'ALL_OFF'),
    hardwareService.queue('owner', 'board', 'DRAIN', 1000),
  ]);
  assert.equal(stopResult.status, 'fulfilled');
  assert.equal(startResult.status, 'rejected');
  assert.match(String((startResult as PromiseRejectedResult).reason), /stop must be acknowledged or terminal/);
  assert.equal(rows.filter((row) => row.action === 'FILL')[0].status, 'EXPIRED');
  assert.equal(rows.filter((row) => row.status === 'PENDING').map((row) => row.action).join(','), 'ALL_OFF');

  const stopSync = await hardwareService.sync('owner', 'board', state);
  assert.equal(stopSync.command, null);
  const stopId = rows.find((row) => row.action === 'ALL_OFF')!.id;
  assert.equal(await hardwareService.acknowledge('owner', 'board', { id: stopId, source: 'hardware', result: 'accepted' }), true);
  const afterAck = await hardwareService.sync('owner', 'board', state);
  assert.equal(afterAck.command, null);

  await hardwareService.queue('owner', 'board', 'FILL', 1000);
  const startSync = await hardwareService.sync('owner', 'board', state);
  assert.equal(startSync.command, null);
});

test('WATER_STOP blocks water starts only, while ALL_OFF blocks every actuator start', async () => {
  mockSerializedDatabase();
  const hardwareRows: any[] = [];
  const feedRows: any[] = [];
  let nextId = 0;
  mock.method(HardwareCommand, 'create', async (values: any) => {
    const row = { ...values, id: `command-${++nextId}`, status: 'PENDING' };
    hardwareRows.push(row);
    return row;
  });
  mock.method(HardwareCommand, 'findOne', async (options: any) => {
    const { where } = options;
    return hardwareRows.find((row) => row.userId === where.userId && row.deviceId === where.deviceId &&
      row.status === where.status && (where.action?.[Op.in] ? where.action[Op.in].includes(row.action) :
        !where.action || row.action === where.action)) || null;
  });
  mock.method(HardwareCommand, 'count', async () => 0);
  mock.method(HardwareCommand, 'update', async (changes: any, options: any) => {
    let updated = 0;
    for (const row of hardwareRows) {
      const where = options.where;
      if (row.userId !== where.userId || row.deviceId !== where.deviceId || row.status !== where.status) continue;
      if (where.action?.[Op.in] && !where.action[Op.in].includes(row.action)) continue;
      Object.assign(row, changes);
      updated++;
    }
    return [updated];
  });
  mock.method(FeedingCommand, 'update', async () => [0]);
  mock.method(FeedingCommand, 'findOne', async (options: any) => {
    const { where } = options;
    return feedRows.find((row) => row.userId === where.userId && row.deviceId === where.deviceId &&
      row.status === where.status) || null;
  });
  mock.method(FeedingCommand, 'create', async (values: any) => {
    const row = { ...values, id: `feed-${++nextId}`, status: 'PENDING' };
    feedRows.push(row);
    return row;
  });

  await hardwareService.queue('owner', 'board', 'WATER_STOP');
  await assert.rejects(hardwareService.queue('owner', 'board', 'FILL', 1000), /stop must be acknowledged or terminal/);
  await assert.rejects(hardwareService.queue('owner', 'board', 'AUTOMATION_ON'), /stop must be acknowledged or terminal/);
  await hardwareService.queue('owner', 'board', 'AERATOR_ON');
  await hardwareService.queue('owner', 'board', 'BUZZER_ON');
  assert.equal(hardwareRows.filter((row) => row.status === 'PENDING').map((row) => row.action).join(','),
    'WATER_STOP,AERATOR_ON,BUZZER_ON');

  await hardwareService.queue('owner', 'board', 'ALL_OFF');
  for (const [action, duration] of [['FILL', 1000], ['AUTOMATION_ON'], ['AERATOR_ON'], ['BUZZER_ON']] as const) {
    await assert.rejects(hardwareService.queue('owner', 'board', action, duration), /stop must be acknowledged or terminal/);
  }
  await assert.rejects(feedingService.queueManualCommand('owner', 'board', 'TRIGGER'), /stop must be acknowledged or terminal/);
});

test('receipts are owner/device scoped and duplicate acknowledgments do not execute again', async () => {
  mockSerializedDatabase();
  let writes = 0;
  const command = { status: 'PENDING', async update(value: { status: string }) { this.status = value.status; writes++; } };
  const find = mock.method(HardwareCommand, 'findOne', async () => command);
  const receipt = { id, source: 'hardware' as const, result: 'accepted' };
  assert.equal(await hardwareService.acknowledge('owner', 'board', receipt), true);
  assert.equal(await hardwareService.acknowledge('owner', 'board', receipt), true);
  assert.equal(writes, 1);
  assert.deepEqual(find.mock.calls[0].arguments[0]?.where, { id, userId: 'owner', deviceId: 'board' });
  mock.method(HardwareCommand, 'findOne', async () => null);
  assert.equal(await hardwareService.acknowledge('other-owner', 'board', receipt), false);
});

test('authenticated HTTPS sync updates heartbeat and schedules without delivering or expiring commands', async () => {
  mockSerializedDatabase();
  const expiry = mock.method(HardwareCommand, 'update', async () => [1]);
  const feedExpiry = mock.method(FeedingCommand, 'update', async () => [1]);
  const stateWrite = mock.method(HardwareDeviceState, 'upsert', async () => [state, true]);
  mock.method(HardwareCommand, 'findOne', async () => ({ id, action: 'WATER_STOP', durationMs: null, expiresAt: new Date(Date.now() + 60000) }));
  mock.method(FeedingCommand, 'findOne', async () => ({ id: 'feed', action: 'TRIGGER', createdAt: new Date() }));
  mock.method(feedingService, 'listSchedules', async () => Array.from({ length: 25 }, (_, i) => ({ id: String(i), enabled: i !== 0, time: '08:00', date: null })));
  const result = await hardwareService.sync('owner', 'board', state);
  assert.equal(result.command, null);
  assert.equal(result.schedules.length, 20); assert.equal(result.schedules[0].id, '1');
  assert.equal(stateWrite.mock.callCount(), 1);
  assert.deepEqual(stateWrite.mock.calls[0].arguments[0], { deviceId: 'board', state, receivedAt: stateWrite.mock.calls[0].arguments[0]?.receivedAt });
  assert.equal(expiry.mock.callCount(), 0); assert.equal(feedExpiry.mock.callCount(), 0);
});

test('signed actuator command and state ACK canonical strings verify HMAC-SHA256', () => {
  const key = 'test-device-secret';
  const command = { v: 1 as const, deviceId: 'board', id, source: 'hardware' as const, action: 'DRAIN', durationMs: 1200, expiresAt: 123456 };
  const signature = signCanonical(commandCanonical(command), key);
  assert.equal(verifyCanonical(commandCanonical(command), signature, key), true);
  assert.equal(verifyCanonical(commandCanonical(command), signature, 'wrong-key'), false);
  const ack = { v: 1 as const, deviceId: 'board', id, source: 'hardware' as const, action: 'DRAIN', result: 'accepted', reportedAt: 123456,
    state, signature: '' };
  assert.equal(ackCanonical(ack), `v1|board|${id}|hardware|DRAIN|accepted|123456|0|0|0|0|0|0|IDLE||0|0|1|1|123`);
  const ackSignature = signCanonical(ackCanonical(ack), key);
  assert.equal(verifyCanonical(ackCanonical(ack), ackSignature, key), true);
  assert.equal(verifyCanonical(ackCanonical({ ...ack, state: { ...state, drainPump: true } }), ackSignature, key), false);
  const signedAck = { ...ack, signature: ackSignature };
  assert.deepEqual(parseSignedAck(JSON.stringify(signedAck)), signedAck);
  assert.equal(parseSignedAck(JSON.stringify({ ...signedAck, ...state, state: undefined })), null);
});

test('MQTT ACK persists its nested state and acknowledges only the matching scoped command', async () => {
  let status = 'PENDING';
  const command = { action: 'DRAIN', status, async update(values: { status: string; result: string }) { status = values.status; } };
  const find = mock.method(HardwareCommand, 'findOne', async () => command);
  const upsert = mock.method(HardwareDeviceState, 'upsert', async () => [state, true]);
  const ack = { v: 1 as const, deviceId: 'board', id, source: 'hardware' as const, action: 'DRAIN', result: 'accepted',
    reportedAt: 123456, state, signature: 'verified-by-mqtt-listener' };
  assert.equal(await hardwareService.acceptMqttAck('owner', ack), true);
  assert.equal(status, 'ACKED');
  assert.deepEqual(find.mock.calls[0].arguments[0]?.where, { id, userId: 'owner', deviceId: 'board' });
  assert.deepEqual(upsert.mock.calls[0].arguments[0], { deviceId: 'board', state, receivedAt: new Date(123456) });
});

test('MQTT actuator publish signs command and explicitly disables retention', async () => {
  config.device.keys = { board: 'test-device-secret' };
  const publishes: Array<{ topic: string; payload: string; options: { qos: number; retain: boolean } }> = [];
  const service = new MQTTService();
  const fakeClient = { publish(topic: string, payload: string, options: { qos: number; retain: boolean }, callback: (error?: Error) => void) {
    publishes.push({ topic, payload, options }); callback();
  } };
  Object.assign(service as unknown as object, { client: fakeClient, isConnected: true });
  const expiresAt = new Date(Date.now() + 30_000);
  assert.equal(await service.dispatchHardwareCommand({ id, deviceId: 'board', source: 'feeding', action: 'TRIGGER', expiresAt }), true);
  assert.equal(publishes[0].topic, 'aquasense/board/command');
  assert.deepEqual(publishes[0].options, { qos: 1, retain: false });
  const command = parseSignedCommand(JSON.parse(publishes[0].payload));
  assert.ok(command);
  assert.equal(command.source, 'feeding'); assert.equal(command.action, 'TRIGGER'); assert.equal(command.durationMs, 0);
  assert.equal(verifyCanonical(commandCanonical(command), command.signature, 'test-device-secret'), true);
});

test('public-dev actuator publish uses the separate HiveMQ control namespace', async () => {
  const old = {
    publicTelemetryOnly: config.mqtt.publicTelemetryOnly,
    publicCommandsEnabled: config.mqtt.publicCommandsEnabled,
    actuatorCommandsEnabled: config.mqtt.actuatorCommandsEnabled,
    telemetryDeviceId: config.mqtt.telemetryDeviceId,
    controlTopicNamespace: config.mqtt.controlTopicNamespace,
  };
  config.mqtt.publicTelemetryOnly = true;
  config.mqtt.publicCommandsEnabled = true;
  config.mqtt.actuatorCommandsEnabled = true;
  config.mqtt.telemetryDeviceId = 'board';
  config.mqtt.controlTopicNamespace = 'control-test';
  config.device.keys = { board: 'test-device-secret' };
  const publishes: string[] = [];
  const service = new MQTTService();
  Object.assign(service as unknown as object, {
    client: { connected: true, publish(topic: string, _payload: string, _options: unknown, callback: (error?: Error) => void) {
      publishes.push(topic); callback();
    } },
    isConnected: true,
  });
  try {
    assert.equal(await service.dispatchHardwareCommand({ id, deviceId: 'board', source: 'feeding', action: 'TRIGGER',
      expiresAt: new Date(Date.now() + 30_000) }), true);
    assert.deepEqual(publishes, ['control-test/board/command']);
    assert.equal(service.isActuatorCommandChannelConnected(), true);
  } finally {
    config.mqtt.publicTelemetryOnly = old.publicTelemetryOnly;
    config.mqtt.publicCommandsEnabled = old.publicCommandsEnabled;
    config.mqtt.actuatorCommandsEnabled = old.actuatorCommandsEnabled;
    config.mqtt.telemetryDeviceId = old.telemetryDeviceId;
    config.mqtt.controlTopicNamespace = old.controlTopicNamespace;
  }
});

test('MQTT publish callback failure and disconnected broker are not device confirmation', async () => {
  config.device.keys = { board: 'test-device-secret' };
  const service = new MQTTService();
  const noPublish = Object.assign(service as unknown as object, { client: null, isConnected: false }) as unknown as MQTTService;
  assert.equal(await noPublish.dispatchHardwareCommand({ id, deviceId: 'board', source: 'hardware', action: 'ALL_OFF', expiresAt: new Date(Date.now() + 1000) }), false);
  const failingClient = { publish(_topic: string, _payload: string, _options: unknown, callback: (error?: Error) => void) { callback(new Error('broker publish failed')); } };
  Object.assign(service as unknown as object, { client: failingClient, isConnected: true });
  assert.equal(await service.dispatchHardwareCommand({ id, deviceId: 'board', source: 'hardware', action: 'ALL_OFF', expiresAt: new Date(Date.now() + 1000) }), false);
});

test('ORP preserves negative/zero millivolts and never turns absent values into zero', () => {
  assert.equal(parseOrp('-330.4'), -330.4); assert.equal(parseOrp(0), 0);
  for (const value of [null, undefined, '', ' ', true, {}, NaN, Infinity, 'bad']) assert.equal(parseOrp(value), null);
  assert.deepEqual(orpStatistics([{ orp: null }, { orp: -100 }, { orp: 300 }]),
    { parameter: 'ORP (mV)', current: null, average: 100, min: -100, max: 300 });
  assert.equal(orpStatistics([]).average, null);
});

test('integrated MQTT snapshot retains ORP and device identity through persistence and realtime delivery', async () => {
  mock.method(logger, 'info', () => {});
  const save = mock.method(sensorReadingService, 'ingestWithStatus', async (deviceId:string, payload:Record<string,any>) => ({reading:{...payload, deviceId, do:null, doMeasured:false} as any, inserted:true}));
  mock.method(sensorReadingService, 'getStatistics', async () => ({ orp: orpStatistics([{ orp: -330.4 }]) }));
  mock.method(waterAlertNotificationService, 'processReading', async () => undefined);
  const service = new MQTTService();
  let realtime: { orp?: number | null } | undefined;
  service.setRealtimeHandlers({ onReadingReceived: reading => { realtime = reading; } });
  await (service as unknown as { handleSensorReading(payload: string): Promise<void> }).handleSensorReading(
    JSON.stringify({ deviceId: 'board', temperature: 26, ph: 7, turbidity: 500, turbidityUnit: 'raw_adc', orp: -330.4 }));
  const args = save.mock.calls[0].arguments;
  assert.equal(args[0], 'board'); assert.equal(args[1].do, undefined); assert.equal(args[1].orp, -330.4);
  assert.equal(realtime?.orp, -330.4);
});

test('HTTP sync requires a configured matching key and active device even in development; user commands require ownership', async () => {
  config.device.keys = { board: 'test-key' };
  mock.method(logger, 'warn', () => {});
  mock.method(auditLogService, 'createLog', async () => null);
  mock.method(deviceService, 'getActiveDevice', async () => ({ userId: 'owner' }));
  const sync = mock.method(hardwareService, 'sync', async () => ({ command: null, schedules: [] }));
  const app = express(); app.use(express.json(), csrfProtection, hardwareRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown, headers: Record<string, string> = {}) => fetch(base + path,
    { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    for (const headers of [{}, { 'x-device-key': 'wrong-key' }] as Array<Record<string, string>>) {
      assert.equal((await post('/hardware/device/sync', { deviceId: 'board', state }, headers)).status, 401);
    }
    assert.equal((await post('/hardware/device/sync', { deviceId: 'unknown', state }, { 'x-device-key': 'test-key' })).status, 401);
    const accepted = await post('/hardware/device/sync', { deviceId: 'board', state }, { 'x-device-key': 'test-key' });
    assert.equal(accepted.status, 200); assert.equal(sync.mock.callCount(), 1);
    assert.deepEqual(sync.mock.calls[0].arguments.slice(0, 2), ['owner', 'board']);
    mock.method(deviceService, 'getActiveDevice', async () => null);
    assert.equal((await post('/hardware/device/sync', { deviceId: 'board', state }, { 'x-device-key': 'test-key' })).status, 403);
    assert.equal((await post('/hardware/commands', { deviceId: 'board', action: 'ALL_OFF' })).status, 401);
    mock.method(tokenService, 'verifyToken', () => ({ userId: 'owner', email: 'test@example.test', role: 'farmer' }));
    mock.method(deviceService, 'verifyOwnership', async () => false);
    const expiry = new Date(Date.now() + 120_000);
    const queued = mock.method(hardwareService, 'queue', async () => ({ id, action: 'ALL_OFF', status: 'PENDING', result: null, expiresAt: expiry }));
    assert.equal((await post('/hardware/commands', { deviceId: 'board', action: 'ALL_OFF' }, { Authorization: 'Bearer test' })).status, 403);
    assert.equal(queued.mock.callCount(), 0);
    mock.method(deviceService, 'verifyOwnership', async () => true);
    const queueResponse = await post('/hardware/commands', { deviceId: 'board', action: 'ALL_OFF' }, { Authorization: 'Bearer test' });
    assert.equal(queueResponse.status, 202);
    const body = await queueResponse.json() as { data: { id: string; commandId: string; action: string; status: string; result: string | null; expiresAt: string; published: boolean } };
    assert.deepEqual(body.data, { id, commandId: id, action: 'ALL_OFF', status: 'PENDING', result: null, expiresAt: expiry.toISOString(), published: false });
    assert.equal(queued.mock.callCount(), 1);
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});

test('public telemetry-only HTTP mode rejects actuator and manual feed commands before queueing', async () => {
  const oldPublicMode = config.mqtt.publicTelemetryOnly;
  const oldActuatorCommandsEnabled = config.mqtt.actuatorCommandsEnabled;
  config.mqtt.publicTelemetryOnly = true;
  config.mqtt.actuatorCommandsEnabled = false;
  mock.method(tokenService, 'verifyToken', () => ({ userId: 'owner', email: 'test@example.test', role: 'farmer' }));
  const hardwareQueue = mock.method(hardwareService, 'queue', async () => { throw new Error('must not queue'); });
  const feedingQueue = mock.method(feedingService, 'queueManualCommand', async () => { throw new Error('must not queue'); });
  const app = express(); app.use(express.json(), csrfProtection, hardwareRoutes, feedingRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const post = (path: string, body: unknown) => fetch(base + path, { method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' }, body: JSON.stringify(body) });
  try {
    assert.equal((await post('/hardware/commands', { deviceId: 'board', action: 'ALL_OFF' })).status, 503);
    assert.equal((await post('/feeding/manual', { action: 'TRIGGER', deviceId: 'board' })).status, 503);
    assert.equal(hardwareQueue.mock.callCount(), 0);
    assert.equal(feedingQueue.mock.callCount(), 0);
  } finally {
    config.mqtt.publicTelemetryOnly = oldPublicMode;
    config.mqtt.actuatorCommandsEnabled = oldActuatorCommandsEnabled;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('manual feeding fails fast without creating a pending command when private MQTT is offline', async () => {
  const oldPublicMode = config.mqtt.publicTelemetryOnly;
  const oldActuatorCommandsEnabled = config.mqtt.actuatorCommandsEnabled;
  config.mqtt.publicTelemetryOnly = true;
  config.mqtt.actuatorCommandsEnabled = true;
  mock.method(tokenService, 'verifyToken', () => ({ userId: 'owner', email: 'test@example.test', role: 'farmer' }));
  mock.method(deviceService, 'verifyOwnership', async () => true);
  mock.method(MQTTService.prototype, 'isActuatorCommandChannelConnected', () => false);
  const feedingQueue = mock.method(feedingService, 'queueManualCommand', async () => { throw new Error('must not queue'); });
  const app = express(); app.use(express.json(), csrfProtection, feedingRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + '/feeding/manual', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ action: 'TRIGGER', deviceId: 'esp32-feeder-1' }) });
    assert.equal(response.status, 503);
    assert.equal(feedingQueue.mock.callCount(), 0);
  } finally {
    config.mqtt.publicTelemetryOnly = oldPublicMode;
    config.mqtt.actuatorCommandsEnabled = oldActuatorCommandsEnabled;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('manual feeding accepts fresh verified HiveMQ telemetry as the device liveness check', async () => {
  const oldPublicMode = config.mqtt.publicTelemetryOnly;
  const oldActuatorCommandsEnabled = config.mqtt.actuatorCommandsEnabled;
  config.mqtt.publicTelemetryOnly = true;
  config.mqtt.actuatorCommandsEnabled = true;
  mock.method(tokenService, 'verifyToken', () => ({ userId: 'owner', email: 'test@example.test', role: 'farmer' }));
  mock.method(deviceService, 'verifyOwnership', async () => true);
  mock.method(MQTTService.prototype, 'isActuatorCommandChannelConnected', () => true);
  mock.method(MQTTService.prototype, 'isTelemetryDeviceOnline', () => true);
  mock.method(hardwareService, 'getState', async () => ({ deviceId: 'esp32-feeder-1', online: false, receivedAt: null, state: null, commands: [] }));
  mock.method(feedingService, 'queueManualCommand', async () => ({ id, createdAt: new Date() } as any));
  mock.method(MQTTService.prototype, 'dispatchHardwareCommand', async () => true);
  mock.method(auditLogService, 'createLog', async () => ({} as any));
  const app = express(); app.use(express.json(), csrfProtection, feedingRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + '/feeding/manual', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ action: 'TRIGGER', deviceId: 'esp32-feeder-1' }) });
    assert.equal(response.status, 202);
    assert.equal((await response.json() as { data: { published: boolean } }).data.published, true);
  } finally {
    config.mqtt.publicTelemetryOnly = oldPublicMode;
    config.mqtt.actuatorCommandsEnabled = oldActuatorCommandsEnabled;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test('manual feeding removes the pending row when MQTT rejects a publish after the connection check', async () => {
  const oldPublicMode = config.mqtt.publicTelemetryOnly;
  const oldActuatorCommandsEnabled = config.mqtt.actuatorCommandsEnabled;
  config.mqtt.publicTelemetryOnly = true;
  config.mqtt.actuatorCommandsEnabled = true;
  mock.method(tokenService, 'verifyToken', () => ({ userId: 'owner', email: 'test@example.test', role: 'farmer' }));
  mock.method(deviceService, 'verifyOwnership', async () => true);
  mock.method(MQTTService.prototype, 'isActuatorCommandChannelConnected', () => true);
  mock.method(MQTTService.prototype, 'dispatchHardwareCommand', async () => false);
  mock.method(hardwareService, 'getState', async () => ({ deviceId: 'esp32-feeder-1', online: true, receivedAt: new Date(), state }));
  mock.method(feedingService, 'queueManualCommand', async () => ({ id, createdAt: new Date() } as any));
  const discard = mock.method(feedingService, 'discardUnpublishedManualCommand', async () => {});
  const app = express(); app.use(express.json(), csrfProtection, feedingRoutes);
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    const response = await fetch(base + '/feeding/manual', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test' },
      body: JSON.stringify({ action: 'TRIGGER', deviceId: 'esp32-feeder-1' }) });
    assert.equal(response.status, 503);
    assert.equal(discard.mock.callCount(), 1);
    assert.deepEqual(discard.mock.calls[0].arguments, ['owner', 'esp32-feeder-1', id]);
  } finally {
    config.mqtt.publicTelemetryOnly = oldPublicMode;
    config.mqtt.actuatorCommandsEnabled = oldActuatorCommandsEnabled;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
