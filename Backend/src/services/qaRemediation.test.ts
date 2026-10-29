import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { Op } from 'sequelize';
import { thresholdPatchSchema, sensorIngestSchema, feedingDeviceAckSchema } from '../middleware/validate';
import { PredictionLog as PredictionLogModel } from '../database/models/PredictionLog';
import { predictionLogService } from './predictionLog.service';
import { Alert as AlertModel } from '../database/models/Alert';
import { alertService } from './alert.service';
import { tokenService } from '../utils/tokenService';

afterEach(() => mock.restoreAll());

test('threshold and device payload schemas reject malformed values', () => {
  assert.equal(thresholdPatchSchema.safeParse({ temperature: { warning: 'hot' } }).success, false);
  assert.equal(thresholdPatchSchema.safeParse({ temperature: { min: 15, max: 35, warning: 30 } }).success, true);
  assert.equal(sensorIngestSchema.safeParse({ deviceId: 'board', ph: Number.NaN }).success, false);
  assert.equal(sensorIngestSchema.safeParse({ deviceId: 'board', ph: 'malformed' }).success, true);
  assert.equal(sensorIngestSchema.safeParse({ deviceId: 'board', turbidityUnit: 'unsupported' }).success, false);
  assert.equal(feedingDeviceAckSchema.safeParse({ deviceId: 'board', commandId: 'not-a-uuid' }).success, false);
});

test('prediction history requests newest records first', async () => {
  let query: Record<string, unknown> | undefined;
  mock.method(PredictionLogModel, 'findAll', async (options: Record<string, unknown>) => {
    query = options;
    return [];
  });
  await predictionLogService.getRecentLogs(10);
  assert.deepEqual(query?.order, [['createdAt', 'DESC']]);
});

test('logout revokes the issued bearer token', () => {
  const token = tokenService.generateToken({ userId: 'user-1', email: 'user@example.com', role: 'farmer' });
  assert.ok(tokenService.verifyToken(token));
  tokenService.revokeToken(token);
  assert.equal(tokenService.verifyToken(token), null);
});

test('alert queries apply the caller device scope', async () => {
  let oneQuery: Record<string, unknown> | undefined;
  let manyQuery: Record<string, unknown> | undefined;
  mock.method(AlertModel, 'findOne', async (options: Record<string, unknown>) => { oneQuery = options; return null; });
  mock.method(AlertModel, 'findAll', async (options: Record<string, unknown>) => { manyQuery = options; return []; });
  await alertService.getAlertById('alert-1', ['device-a']);
  await alertService.getAlerts(10, undefined, ['device-a']);
  assert.deepEqual((oneQuery?.where as Record<string, unknown>).deviceId, { [Op.in]: ['device-a'] });
  assert.ok(manyQuery?.where);
});
