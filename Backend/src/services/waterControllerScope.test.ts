import test, { afterEach, mock } from 'node:test';
import assert from 'node:assert/strict';
import { getDashboardData, getLatestReading, getPredictionHistory, getReadingsByTimeRange, getStatistics as getStatisticsController } from '../iot/water/controllers/waterController';
import { deviceService } from './device.service';
import { sensorReadingService } from './sensorReadingService';
import { alertService } from './alert.service';
import { predictiveAnalyticsService } from './predictiveAnalytics.service';
import { predictionLogService } from './predictionLog.service';
import { smsLogService } from './smsLogService';
import { waterQualityService } from '../iot/water/services/waterQualityService';

afterEach(() => mock.restoreAll());

const request = (userId?: string, userRole?: 'admin' | 'farmer') => ({ userId, userRole, query: {} }) as any;
const response = () => {
  const res: any = {
    statusCode: 0,
    body: undefined,
    status(code: number) { this.statusCode = code; return this; },
    json(body: unknown) { this.body = body; return this; },
  };
  return res;
};

test('latest reading scopes farmers to active owned devices and leaves admin scope global', async () => {
  const listByUser = mock.method(deviceService, 'listByUser', async () => [
    { deviceId: 'owned-active', isActive: true },
    { deviceId: 'owned-inactive', isActive: false },
  ] as any);
  const getLatestReading = mock.method(sensorReadingService, 'getLatestReading', async () => null);

  await getLatestReadingController(request('farmer-a', 'farmer'));
  assert.deepEqual(getLatestReading.mock.calls[0].arguments[0], ['owned-active']);
  assert.deepEqual(listByUser.mock.calls[0].arguments, ['farmer-a']);

  await getLatestReadingController(request('admin-a', 'admin'));
  assert.equal(getLatestReading.mock.calls[1].arguments[0], undefined);
  assert.equal(listByUser.mock.callCount(), 1);
});

test('latest reading with missing identity passes an empty scope and does not list devices', async () => {
  const listByUser = mock.method(deviceService, 'listByUser', async () => []);
  const getLatestReading = mock.method(sensorReadingService, 'getLatestReading', async () => null);

  await getLatestReadingController(request(undefined, 'farmer'));

  assert.deepEqual(getLatestReading.mock.calls[0].arguments[0], []);
  assert.equal(listByUser.mock.callCount(), 0);
});

test('time-range readings and statistics receive the active owned-device scope', async () => {
  mock.method(deviceService, 'listByUser', async () => [
    { deviceId: 'tank-a', isActive: true },
    { deviceId: 'tank-old', isActive: false },
  ] as any);
  const getReadings = mock.method(sensorReadingService, 'getReadingsByTimeRange', async () => [] as any);
  const getStatistics = mock.method(sensorReadingService, 'getStatistics', async () => ({
    orp: {}, temperature: {}, ph: {}, do: {}, turbidity: {}, ammonia: {}, healthScore: null,
  } as any));

  await getReadingsByTimeRange({ ...request('farmer-a', 'farmer'), query: { minutes: '60' } } as any, response());
  await getStatisticsController({ ...request('farmer-a', 'farmer'), query: { minutes: '60' } } as any, response());

  assert.deepEqual(getReadings.mock.calls[0].arguments[1], ['tank-a']);
  assert.deepEqual(getStatistics.mock.calls[0].arguments[1], ['tank-a']);
});

test('dashboard latest and statistics receive the active owned-device scope', async () => {
  mock.method(deviceService, 'listByUser', async () => [
    { deviceId: 'tank-a', isActive: true },
    { deviceId: 'tank-old', isActive: false },
  ] as any);
  const getLatestReading = mock.method(sensorReadingService, 'getLatestReading', async () => null);
  const getStatistics = mock.method(sensorReadingService, 'getStatistics', async () => ({
    orp: {}, temperature: {}, ph: {}, do: {}, turbidity: {}, ammonia: {}, healthScore: null,
  } as any));
  const getPredictionLogs = mock.method(predictionLogService, 'getRecentLogs', async () => [] as any);
  const getSmsLogs = mock.method(smsLogService, 'getRecentLogs', async () => [] as any);
  mock.method(alertService, 'getAlerts', async () => [] as any);
  mock.method(waterQualityService, 'getThresholds', () => ({} as any));
  mock.method(predictiveAnalyticsService, 'getWarningCard', async () => null as any);

  const res = response();
  await getDashboardData(request('farmer-a', 'farmer'), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(getLatestReading.mock.calls[0].arguments[0], ['tank-a']);
  assert.deepEqual(getStatistics.mock.calls[0].arguments[1], ['tank-a']);
  assert.deepEqual(getPredictionLogs.mock.calls[0].arguments, [30, ['tank-a']]);
  assert.deepEqual(getSmsLogs.mock.calls[0].arguments, [15, ['tank-a']]);
});

test('prediction history forwards empty identity and admin scopes', async () => {
  const listByUser = mock.method(deviceService, 'listByUser', async () => []);
  const getRecentLogs = mock.method(predictionLogService, 'getRecentLogs', async () => [] as any);

  await getPredictionHistory(request(undefined, 'farmer'), response());
  assert.deepEqual(getRecentLogs.mock.calls[0].arguments, [60, []]);
  assert.equal(listByUser.mock.callCount(), 0);

  await getPredictionHistory(request('admin-a', 'admin'), response());
  assert.deepEqual(getRecentLogs.mock.calls[1].arguments, [60, undefined]);
  assert.equal(listByUser.mock.callCount(), 0);
});

const getLatestReadingController = async (req: any) => {
  await getLatestReading(req, response());
};
