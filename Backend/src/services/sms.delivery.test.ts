import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import axios, { AxiosError } from 'axios';
import type { Request, Response } from 'express';
import { config } from '../config/config';
import { logger } from '../utils/logger';
import {
  describeSmsFailure, parseIprogSendResponse, parseIprogStatusResponse,
  SmsService, smsService, smsResult, toSemaphoreNumber,
} from './sms.service';
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
  config.sms.provider = 'unisms';
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
test('a manual test is only delayed while real alerts stay blocked', async () => {
  const ago = (ms: number) => new Date(Date.now() - ms);
  const read = mock.method(smsLogService, 'getLatestLog', async () => ({ success: false, deliveryStatus: 'unknown', sentAt: ago(60000) }));
  assert.equal(await cooldownService.shouldSendSms('sms-test', 'SMS_TEST', 'INFO'), false);
  read.mock.mockImplementation(async () => ({ success: false, deliveryStatus: 'unknown', sentAt: ago(300000) }));
  assert.equal(await cooldownService.shouldSendSms('sms-test', 'SMS_TEST', 'INFO'), true);
  assert.equal(await cooldownService.shouldSendSms('device', 'WATER_ALERT', 'INFO'), false);
  read.mock.mockImplementation(async () => ({ success: true, deliveryStatus: 'sent', sentAt: ago(30000), severity: 'INFO' }));
  assert.equal(await cooldownService.shouldSendSms('sms-test', 'SMS_TEST', 'INFO'), false);
  read.mock.mockImplementation(async () => ({ success: true, deliveryStatus: 'sent', sentAt: ago(60000), severity: 'INFO' }));
  assert.equal(await cooldownService.shouldSendSms('sms-test', 'SMS_TEST', 'INFO'), true);
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

function setupSemaphore(senderName?: string): SmsService {
  const service = setup();
  config.sms.provider = 'semaphore';
  config.sms.apiSecretKey = 'semaphore-unit-key';
  config.sms.senderId = senderName;
  return service;
}
const semaphoreMessage = (status: string) => ({ status: 200, data: [{ message_id: 12345, recipient: '639171234567', status, sender_name: 'AquaSense' }] });

test('Semaphore: sends a form post with the API key, 63 number and sender name', async () => {
  const service = setupSemaphore('AquaSense');
  const post = mock.method(axios, 'post', async () => semaphoreMessage('Pending'));
  const result = await service.sendSms(phone, message);
  assert.equal(post.mock.callCount(), 1);
  const [url, body, options] = post.mock.calls[0].arguments as unknown as [string, string, { headers: Record<string, string> }];
  assert.equal(url, 'https://api.semaphore.co/api/v4/messages');
  const form = new URLSearchParams(body);
  assert.equal(form.get('apikey'), 'semaphore-unit-key');
  assert.equal(form.get('number'), '639171234567');
  assert.equal(form.get('message'), message);
  assert.equal(form.get('sendername'), 'AquaSense');
  assert.equal(options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(result.status, 'pending');
  assert.equal(result.accepted, true);
  assert.equal(result.referenceId, '12345');
  assert.equal(result.response.includes('semaphore-unit-key'), false);
});

test('Semaphore: without a sender name the account default is used', async () => {
  const service = setupSemaphore(undefined);
  const post = mock.method(axios, 'post', async () => semaphoreMessage('Queued'));
  const result = await service.sendSms(phone, message);
  const form = new URLSearchParams(post.mock.calls[0].arguments[1] as unknown as string);
  assert.equal(form.has('sendername'), false);
  assert.equal(result.status, 'pending');
});

test('Semaphore: maps Sent, Failed and Refunded statuses', async () => {
  const service = setupSemaphore('AquaSense');
  for (const [raw, expected] of [['Sent', 'sent'], ['Failed', 'failed'], ['Refunded', 'failed']] as const) {
    mock.method(axios, 'post', async () => semaphoreMessage(raw));
    assert.equal((await service.sendSms(phone, message)).status, expected);
    mock.restoreAll();
    mock.method(logger, 'info', () => {});
  }
});

test('Semaphore: refuses non-Philippine numbers and messages starting with TEST without calling it', async () => {
  const service = setupSemaphore('AquaSense');
  const post = mock.method(axios, 'post', async () => semaphoreMessage('Pending'));
  assert.equal((await service.sendSms('+14155552671', message)).status, 'rejected');
  assert.equal((await service.sendSms(phone, 'Test message from AquaSense')).status, 'rejected');
  assert.equal((await service.sendSms(phone, 'AquaSense test notification.')).status, 'pending');
  assert.equal(post.mock.callCount(), 1);
  assert.equal(toSemaphoreNumber('+639171234567'), '639171234567');
  assert.equal(toSemaphoreNumber('09171234567'), null);
});

test('Semaphore: a missing API key is reported without calling the provider', async () => {
  const service = setupSemaphore('AquaSense');
  config.sms.apiSecretKey = undefined;
  const post = mock.method(axios, 'post', async () => semaphoreMessage('Pending'));
  const result = await service.sendSms(phone, message);
  assert.equal(result.status, 'rejected');
  assert.match(result.response, /SEMAPHORE_API_KEY/);
  assert.equal(post.mock.callCount(), 0);
});

test('Semaphore: field errors are a rejection with a plain explanation, never a resend', async () => {
  const service = setupSemaphore('NotApproved');
  const post = mock.method(axios, 'post', async () => ({ status: 200, data: { sendername: ['The selected sendername is invalid.'] } }));
  const ok = await service.sendSms(phone, message);
  assert.equal(ok.status, 'rejected');
  assert.equal(post.mock.callCount(), 1);
  assert.match(describeSmsFailure([ok]), /Semaphore does not accept that sender name/);

  mock.restoreAll();
  mock.method(logger, 'warn', () => {});
  const error = new AxiosError('Rejected', 'ERR_BAD_REQUEST', undefined, undefined, {
    status: 422, statusText: 'Unprocessable', data: { apikey: ['The apikey is invalid.'] }, headers: {}, config: { headers: {} } as never,
  });
  const failing = mock.method(axios, 'post', async () => { throw error; });
  const rejected = await service.sendSms(phone, message);
  assert.equal(rejected.status, 'rejected');
  assert.equal(failing.mock.callCount(), 1);
  assert.match(describeSmsFailure([rejected]), /SEMAPHORE_API_KEY/);
});

test('Semaphore: status lookup reads the message by ID and never resubmits', async () => {
  const service = setupSemaphore('AquaSense');
  const post = mock.method(axios, 'post', async () => semaphoreMessage('Pending'));
  const get = mock.method(axios, 'get', async () => semaphoreMessage('Sent'));
  const result = await service.getStatus('12345');
  const [url, options] = get.mock.calls[0].arguments as unknown as [string, { params: Record<string, string> }];
  assert.equal(url, 'https://api.semaphore.co/api/v4/messages/12345');
  assert.equal(options.params.apikey, 'semaphore-unit-key');
  assert.equal(result.status, 'sent');
  assert.equal(post.mock.callCount(), 0);
  assert.equal(result.response.includes('semaphore-unit-key'), false);
});

function setupIprog(): SmsService {
  const service = setup();
  config.sms.provider = 'iprogsms';
  config.sms.apiSecretKey = 'iprog-unit-token';
  config.sms.senderId = undefined;
  config.sms.iprogNetworkProvider = 2;
  config.sms.iprogBaseUrl = 'https://www.iprogsms.com/api/v1';
  return service;
}

const iprogQueued = () => ({
  status: 200,
  data: {
    status: 200,
    message: 'Your SMS message has been successfully added to the queue and will be processed shortly.',
    message_id: 'iSms-XHYBk',
  },
});

test('IPROG SMS: posts JSON with api_token, 63 number, sms_provider 2 and Bearer auth', async () => {
  const service = setupIprog();
  const post = mock.method(axios, 'post', async () => iprogQueued());
  const result = await service.sendSms(phone, message);
  assert.equal(post.mock.callCount(), 1);
  const [url, body, options] = post.mock.calls[0].arguments as unknown as [
    string,
    Record<string, unknown>,
    { headers: Record<string, string> },
  ];
  assert.equal(url, 'https://www.iprogsms.com/api/v1/sms_messages');
  assert.deepEqual(body, {
    api_token: 'iprog-unit-token',
    phone_number: '639171234567',
    message,
    sms_provider: 2,
  });
  assert.equal(options.headers.Authorization, 'Bearer iprog-unit-token');
  assert.equal(result.status, 'pending');
  assert.equal(result.accepted, true);
  assert.equal(result.referenceId, 'iSms-XHYBk');
  assert.equal(result.response.includes('iprog-unit-token'), false);
});

test('IPROG SMS: refuses non-Philippine numbers and a missing token without calling it', async () => {
  const service = setupIprog();
  const post = mock.method(axios, 'post', async () => iprogQueued());
  assert.equal((await service.sendSms('+14155552671', message)).status, 'rejected');
  assert.equal(post.mock.callCount(), 0);
  config.sms.apiSecretKey = undefined;
  assert.equal((await service.sendSms(phone, message)).status, 'rejected');
  assert.match((await service.sendSms(phone, message)).response, /IPROG_SMS_API_TOKEN/);
  assert.equal(post.mock.callCount(), 0);
});

test('IPROG SMS: parse helpers map queue accept and completed status', () => {
  const queued = parseIprogSendResponse({
    status: 200, message: 'queued', message_id: 'iSms-Ab12',
  }, 200, 0);
  assert.equal(queued.status, 'pending');
  assert.equal(queued.referenceId, 'iSms-Ab12');
  assert.equal(parseIprogStatusResponse({ status: 200, message_status: 'pending' }, 200, 'iSms-Ab12').status, 'pending');
  assert.equal(parseIprogStatusResponse({ status: 200, message_status: 'completed' }, 200, 'iSms-Ab12').status, 'sent');
  assert.equal(parseIprogStatusResponse({ status: 200, message_status: 'failed' }, 200, 'iSms-Ab12').status, 'failed');
});

test('IPROG SMS: status lookup reads message_id and never resubmits', async () => {
  const service = setupIprog();
  const post = mock.method(axios, 'post', async () => iprogQueued());
  const get = mock.method(axios, 'get', async () => ({ status: 200, data: { status: 200, message_status: 'completed' } }));
  const result = await service.getStatus('iSms-XHYBk');
  const [url, options] = get.mock.calls[0].arguments as unknown as [string, { params: Record<string, string>; headers: Record<string, string> }];
  assert.equal(url, 'https://www.iprogsms.com/api/v1/sms_messages/status');
  assert.equal(options.params.api_token, 'iprog-unit-token');
  assert.equal(options.params.message_id, 'iSms-XHYBk');
  assert.equal(options.headers.Authorization, 'Bearer iprog-unit-token');
  assert.equal(result.status, 'sent');
  assert.equal(post.mock.callCount(), 0);
});

