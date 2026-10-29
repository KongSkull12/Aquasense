import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { Alert } from '../database/models/Alert';
import { PredictionLog as PredictionLogModel } from '../database/models/PredictionLog';
import { SmsLog as SmsLogModel } from '../database/models/SmsLog';
import { predictionLogService } from './predictionLog.service';
import { smsLogService } from './smsLogService';

afterEach(() => mock.restoreAll());

test('prediction logs filter to rows linked to alerts for the scoped devices', async () => {
  const findAlerts = mock.method(Alert, 'findAll', async () => [{ id: 'owned-alert' }] as any);
  const findLogs = mock.method(PredictionLogModel, 'findAll', async () => [] as any);

  await predictionLogService.getRecentLogs(12, ['owned-device']);

  assert.deepEqual(findAlerts.mock.calls[0]!.arguments[0]!.where, {
    deviceId: { [Op.in]: ['owned-device'] },
  });
  assert.deepEqual(findLogs.mock.calls[0]!.arguments[0]!.where, {
    triggeredAlertId: { [Op.in]: ['owned-alert'] },
  });
  assert.equal(findLogs.mock.calls[0]!.arguments[0]!.limit, 12);
});

test('prediction logs fail closed for an empty scope and remain global for admin scope', async () => {
  const findAlerts = mock.method(Alert, 'findAll', async () => [] as any);
  const findLogs = mock.method(PredictionLogModel, 'findAll', async () => [] as any);

  assert.deepEqual(await predictionLogService.getRecentLogs(12, []), []);
  assert.equal(findAlerts.mock.callCount(), 0);
  assert.equal(findLogs.mock.callCount(), 0);

  await predictionLogService.getRecentLogs(12, undefined);
  assert.equal(findAlerts.mock.callCount(), 0);
  assert.equal(findLogs.mock.callCount(), 1);
  assert.equal(findLogs.mock.calls[0]!.arguments[0]!.where, undefined);
});

test('SMS logs filter to scoped device IDs, fail closed on empty scope, and remain global for admin scope', async () => {
  const findLogs = mock.method(SmsLogModel, 'findAll', async () => [] as any);

  await smsLogService.getRecentLogs(8, ['owned-device']);
  assert.deepEqual(findLogs.mock.calls[0]!.arguments[0]!.where, {
    deviceId: { [Op.in]: ['owned-device'] },
  });
  assert.equal(findLogs.mock.calls[0]!.arguments[0]!.limit, 8);

  assert.deepEqual(await smsLogService.getRecentLogs(8, []), []);
  assert.equal(findLogs.mock.callCount(), 1);

  await smsLogService.getRecentLogs(8, undefined);
  assert.equal(findLogs.mock.callCount(), 2);
  assert.equal(findLogs.mock.calls[1]!.arguments[0]!.where, undefined);
});
