import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import type { Request, Response } from 'express';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import { SmsService, smsService, smsResult } from './sms.service';
import { smsNotificationService } from './smsNotification.service';
import { smsLogService } from './smsLogService';
import { cooldownService } from './cooldown.service';
import { SmsLog } from '../database/models/SmsLog';
import { Alert } from '../database/models/Alert';
import * as connection from '../database/connection';
import { sendTestSms } from '../api/v1/controllers/smsController';
import { ruleEngine } from './ruleEngine.service';
import { MQTTService } from './mqttService';
import { sensorReadingService, type SensorReading } from './sensorReadingService';
import { waterAlertNotificationService } from './waterAlertNotification.service';
import { predictiveAnalyticsService } from './predictiveAnalytics.service';

const phone = '+639171234567';
const message = 'AquaSense test notification.';
const settings = { ...config.sms };
afterEach(() => { mock.restoreAll(); Object.assign(config.sms, settings); });

function setup(): SmsService {
  config.sms.apiSecretKey = 'unit-test-key';
  config.sms.senderId = 'AquaSense';
  mock.method(logger, 'info', () => {});
  mock.method(logger, 'warn', () => {});
  return new SmsService();
}
const provider = (status: string) => ({ status: 201, data: { message: { status, reference_id: 'msg_test', fail_reason: status === 'failed' ? 'Carrier rejected' : null } } });
const rejection = (status: number) => new AxiosError('Rejected', 'ERR_BAD_REQUEST', undefined, undefined, {
  status, statusText: 'Rejected', data: { errors: { content: ['Rejected by provider'] } }, headers: {}, config: { headers: {} } as never,
});

test('sends exact configured sender including AquaSense, correct JSON and auth', async () => {
  const service = setup();
  const post = mock.method(axios, 'post', async () => provider('sent'));
  const result = await service.sendSms(phone, message);
  assert.equal(result.success, true);
  assert.equal(result.referenceId, 'msg_test');
  assert.equal(post.mock.callCount(), 1);
  const [url, body, options] = post.mock.calls[0].arguments;
  assert.equal(url, 'https://unismsapi.com/api/sms');
  assert.deepEqual(body, { recipient: phone, content: message, sender_id: 'AquaSense' });
  assert.equal(options?.auth?.username, 'unit-test-key');
  assert.equal(options?.auth?.password, '');
});

test('missing sender rejects locally without calling provider', async () => {
  const service = setup(); config.sms.senderId = ' ';
  const post = mock.method(axios, 'post', async () => provider('sent'));
  assert.equal((await service.sendSms(phone, message)).status, 'rejected');
  assert.equal(post.mock.callCount(), 0);
});

for (const status of [401, 422, 429]) {
  test(`HTTP ${status} is surfaced and not automatically resubmitted`, async () => {
    const service = setup();
    const post = mock.method(axios, 'post', async () => { throw rejection(status); });
    const result = await service.sendSms(phone, message);
    assert.equal(result.success, false); assert.equal(result.httpStatus, status);
    assert.equal(result.retryCount, 0); assert.equal(post.mock.callCount(), 1);
    assert.match(result.response, /Rejected by provider/);
  });
}
for (const status of ['pending', 'retrying', 'failed']) {
  test(`provider ${status} is not marked sent`, async () => {
    const service = setup(); mock.method(axios, 'post', async () => provider(status));
    const result = await service.sendSms(phone, message);
    assert.equal(result.status, status); assert.equal(result.success, false);
    assert.equal(result.accepted, status !== 'failed');
  });
}
for (const code of ['ECONNABORTED', 'ECONNRESET']) {
  test(`${code} is uncertain and not automatically resubmitted`, async () => {
    const service = setup(); const post = mock.method(axios, 'post', async () => { throw new AxiosError('Transport failure', code); });
    assert.equal((await service.sendSms(phone, message)).status, 'unknown');
    assert.equal(post.mock.callCount(), 1);
  });
}
test('connection refusal before submission retries then reports actual sent state', async () => {
  const service = setup(); let calls = 0;
  mock.method(axios, 'post', async () => { if (++calls === 1) throw new AxiosError('Refused', 'ECONNREFUSED'); return provider('sent'); });
  const result = await service.sendSms(phone, message);
  assert.equal(calls, 2); assert.equal(result.retryCount, 1); assert.equal(result.success, true);
});
test('HTTP success with unrecognized body is uncertain', async () => {
  const service = setup(); mock.method(axios, 'post', async () => ({ status: 201, data: {} }));
  assert.equal((await service.sendSms(phone, message)).status, 'unknown');
});
test('status reconciliation reads by reference without sending again', async () => {
  const service = setup();
  const get = mock.method(axios, 'get', async () => provider('sent'));
  const post = mock.method(axios, 'post', async () => provider('sent'));
  assert.equal((await service.getStatus('msg_test')).success, true);
  assert.equal(get.mock.calls[0].arguments[0], 'https://unismsapi.com/api/sms/msg_test');
  assert.equal(post.mock.callCount(), 0);
});

test('test controller returns failure on provider rejection', async () => {
  mock.method(smsNotificationService, 'send', async () => smsResult('rejected', 0, { httpStatus: 422 }));
  let code = 0; let body: { success?: boolean; message?: string } = {};
  const res = { status(value: number) { code = value; return this; }, json(value: typeof body) { body = value; return this; } } as unknown as Response;
  await sendTestSms({ body: { recipient: phone, message } } as Request, res);
  assert.equal(code, 422); assert.equal(body.success, false); assert.doesNotMatch(body.message || '', /^SMS test sent$/);
});
test('test controller returns 202 for accepted pending SMS', async () => {
  mock.method(smsNotificationService, 'send', async () => smsResult('pending', 0, { referenceId: 'msg_test' }));
  let code = 0;
  const res = { status(value: number) { code = value; return this; }, json() { return this; } } as unknown as Response;
  await sendTestSms({ body: { recipient: phone, message } } as Request, res);
  assert.equal(code, 202);
});

test('two simultaneous notifications create one durable reservation and one provider call', async () => {
  const events: string[] = [];
  mock.method(connection, 'getDatabase', () => ({
    async transaction(run: (transaction: object) => Promise<unknown>) { const result = await run({}); events.push('commit'); return result; },
    async query() { return [{ acquired: true }]; },
  }));
  mock.method(cooldownService, 'shouldSendSms', async () => true);
  const reserve = mock.method(smsLogService, 'createLog', async () => { events.push('reserve'); return { id: 'log-test' }; });
  const send = mock.method(smsService, 'sendSms', async () => { events.push('send'); return smsResult('sent'); });
  mock.method(smsLogService, 'updateOutcome', async () => {});
  const input = { deviceId: 'same-device', category: 'WATER_QUALITY_ALERT', severity: 'EMERGENCY' as const, recipient: phone, message };
  const results = await Promise.all([smsNotificationService.send(input), smsNotificationService.send(input)]);
  assert.equal(results.filter(Boolean).length, 1); assert.equal(reserve.mock.callCount(), 1); assert.equal(send.mock.callCount(), 1);
  assert.deepEqual(events, ['reserve', 'commit', 'send']);
});
test('failed database reservation prevents SMS submission', async () => {
  mock.method(connection, 'getDatabase', () => ({ async transaction() { throw new Error('Database unavailable'); } }));
  const send = mock.method(smsService, 'sendSms', async () => smsResult('sent'));
  await assert.rejects(() => smsNotificationService.send({ deviceId: 'db-error', category: 'TEST', severity: 'INFO', recipient: phone, message }), /Database unavailable/);
  assert.equal(send.mock.callCount(), 0);
});
test('pending and uncertain submissions stay blocked; recent failures back off', async () => {
  const read = mock.method(smsLogService, 'getLatestLog', async () => ({ success: false, deliveryStatus: 'pending', sentAt: new Date(0) }));
  assert.equal(await cooldownService.shouldSendSms('device', 'category', 'EMERGENCY'), false);
  read.mock.mockImplementation(async () => ({ success: false, deliveryStatus: 'unknown', sentAt: new Date(0) }));
  assert.equal(await cooldownService.shouldSendSms('device', 'category', 'EMERGENCY'), false);
  read.mock.mockImplementation(async () => ({ success: false, deliveryStatus: 'rejected', sentAt: new Date() }));
  assert.equal(await cooldownService.shouldSendSms('device', 'category', 'EMERGENCY'), false);
});
test('pending log becomes sent and linked alert gets send timestamp', async () => {
  mock.method(SmsLog, 'findAll', async () => [{ id: 'log-test', retryCount: 0, providerResponse: JSON.stringify({ deliveryStatus: 'pending', referenceId: 'msg_test', alertIds: ['alert-test'] }) }]);
  mock.method(smsService, 'getStatus', async () => smsResult('sent', 0, { referenceId: 'msg_test' }));
  const update = mock.method(SmsLog, 'update', async () => [1]);
  const mark = mock.method(Alert, 'update', async () => [1]);
  await smsLogService.reconcilePending();
  assert.equal(update.mock.callCount(), 1); assert.equal(mark.mock.callCount(), 1);
  assert.equal(update.mock.calls[0].arguments[0]!.success, true);
});

test('missing oxygen does not trigger DO emergency; measured zero still does', () => {
  const reading = { temperature: 26, ph: 7.5, turbidity: 5, dissolvedOxygen: 0 };
  assert.equal(ruleEngine({ ...reading, dissolvedOxygenMeasured: false }).some((alert) => alert.category === 'DO_LOW'), false);
  assert.equal(ruleEngine({ ...reading, dissolvedOxygenMeasured: true }).some((alert) => alert.category === 'DO_LOW' && alert.severity === 'EMERGENCY'), true);
});
test('MQTT tags missing oxygen before persistence and notifications', async () => {
  setup();
  const store = mock.method(sensorReadingService, 'ingestWithStatus', async (_device:string, _payload:Record<string,any>) => ({ reading:{ id: 'reading-test', do:null, doMeasured:false } as any, inserted:true }));
  mock.method(sensorReadingService, 'getStatistics', async () => ({}));
  const notify = mock.method(waterAlertNotificationService, 'processReading', async () => ({ alertsCreated: 0, smsSentCount: 0 }));
  const mqtt = new MQTTService() as unknown as { handleSensorReading(payload: string): Promise<void> };
  await mqtt.handleSensorReading(JSON.stringify({ temperature: 26, ph: 7.5, turbidity: 5 }));
  assert.equal(store.mock.calls[0].arguments[1].do, undefined);
  assert.equal(notify.mock.calls[0].arguments[0]!.dissolvedOxygenMeasured, false);
});
test('prediction excludes unmeasured oxygen rather than treating it as a real low reading', async () => {
  mock.method(sensorReadingService, 'getLatestReading', async () => null);
  mock.method(sensorReadingService, 'getReadingsByTimeRange', async () => [{ temperature: 26, ph: 7.5, do: 0, doMeasured: false, turbidity: 5, ammonia: 0, timestamp: new Date() } as SensorReading]);
  const prediction = await predictiveAnalyticsService.getWarningCard();
  assert.equal(prediction.latest, null); assert.equal(prediction.analysisStatus, 'INSUFFICIENT_VALID_SENSOR_DATA');
});
