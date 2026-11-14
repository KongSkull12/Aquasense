import test from 'node:test';
import assert from 'node:assert/strict';
import { describeSmsFailure, isValidSmsRecipient, smsResult, validateSmsMessage } from './sms.service';
import {
  buildCombinedAlertSmsTemplate,
  buildPredictiveSmsTemplate,
  buildSmsSensorLines,
  buildSmsTemplate,
  DEFAULT_TEST_SMS,
  formatSmsAlertTimestamp,
  formatSmsSensorLine,
} from './smsTemplate.service';
import { ruleEngine } from './ruleEngine.service';
import { config } from '../config/config';

test('accepts valid E.164 phone numbers', () => {
  assert.equal(isValidSmsRecipient('+639171234567'), true);
  assert.equal(isValidSmsRecipient('+14155552671'), true);
});

test('rejects invalid phone numbers', () => {
  assert.equal(isValidSmsRecipient('09171234567'), false);
  assert.equal(isValidSmsRecipient('+63-917-123-4567'), false);
  assert.equal(isValidSmsRecipient('+123'), false);
});

test('rejects empty messages', () => {
  const result = validateSmsMessage('   ');
  assert.equal(result.valid, false);
});

test('rejects messages over the configured SMS length', () => {
  const longMessage = 'A'.repeat(config.sms.maxMessageLength + 1);
  const result = validateSmsMessage(longMessage);
  assert.equal(result.valid, false);
});

test('accepts message with max configured characters', () => {
  const message = 'A'.repeat(config.sms.maxMessageLength);
  const result = validateSmsMessage(message);
  assert.equal(result.valid, true);
});

test('rule alert template lists sensors, Disconnected, and alert timestamp', () => {
  const alertAt = new Date('2026-11-13T06:01:44.000Z');
  const message = buildSmsTemplate({
    farmerName: 'Tessie',
    farmName: 'AquaSense Farm',
    tankName: 'Main Tank',
    severity: 'CRITICAL',
    problem: 'pH critically low',
    value: 3.07,
    unit: 'pH',
    action: 'WATER_REPLACEMENT',
    alertAt,
    sensors: buildSmsSensorLines({
      temperature: null,
      ph: 3.07,
      dissolvedOxygen: null,
      dissolvedOxygenMeasured: false,
      turbidity: 114.4,
      turbidityUnit: 'NTU',
      orp: null,
      tankLevel: { connected: false, valid: false, distanceCm: null, depthCm: null, targetDepthCm: null, mountHeightCm: null, levelPercent: null, timestamp: null, reason: 'missing' },
    }),
  });

  assert.ok(message.length <= config.sms.maxMessageLength);
  assert.equal(validateSmsMessage(message).valid, true);
  assert.match(message, /When: /);
  assert.match(message, /Temp: Disconnected/);
  assert.match(message, /pH: 3\.07/);
  assert.doesNotMatch(message, /\bDO:/);
  assert.match(message, /Turbidity: 114\.4 NTU/);
  assert.match(message, /ORP: Disconnected/);
  assert.match(message, /Depth: Disconnected/);
  assert.match(message, /pH critically low/i);
  assert.equal(message.includes(formatSmsAlertTimestamp(alertAt)), true);
});

test('predictive alert template fits SMS length limit and includes When', () => {
  const message = buildPredictiveSmsTemplate({
    farmName: 'AquaSense Farm With A Long Name',
    tankName: 'FirstTank',
    riskLevel: 'CRITICAL',
    cause: 'low dissolved oxygen + elevated ammonia + DO trending down',
    etaMinutes: 12,
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
  });

  assert.ok(message.length <= config.sms.maxMessageLength);
  assert.equal(validateSmsMessage(message).valid, true);
  assert.match(message, /When: /);
});

test('long labels still keep the action and sensor list', () => {
  const message = buildSmsTemplate({
    farmerName: 'Farmer',
    farmName: 'Very long farm name '.repeat(20),
    tankName: 'Very long tank name '.repeat(20),
    severity: 'EMERGENCY',
    problem: 'Dissolved oxygen dangerously low',
    value: 1.5,
    unit: 'mg/L',
    action: 'AERATOR_ON_IMMEDIATE',
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
    sensors: buildSmsSensorLines({
      temperature: 28,
      ph: 7.2,
      dissolvedOxygen: 1.5,
      dissolvedOxygenMeasured: true,
      turbidity: 20,
      turbidityUnit: 'NTU',
      orp: 220,
    }),
  });
  assert.ok(message.length <= config.sms.maxMessageLength);
  assert.match(message, /emergency alert/);
  assert.match(message, /1\.5 mg\/L|Dissolved oxygen/i);
  assert.doesNotMatch(message, /\bDO:/);
  assert.ok(message.includes('Please turn on the aerator immediately.'));
  assert.doesNotMatch(message, /EMERGENCY|\|/);
});

test('all rule-generated messages preserve readings, units and Disconnected for nulls', () => {
  const readings = [
    { temperature: 9, ph: 5.8, dissolvedOxygen: 1.5, turbidity: 110, ammonia: 8 },
    { temperature: 14, ph: 6.3, dissolvedOxygen: 2.8, turbidity: 80, ammonia: 6 },
    { temperature: 36, ph: 8.8, dissolvedOxygen: 4, turbidity: 20, ammonia: 3 },
    { temperature: 33, ph: 8.3, dissolvedOxygen: 6, turbidity: 20, ammonia: 0 },
    { temperature: 30, ph: 7, dissolvedOxygen: 6, turbidity: 20, ammonia: 0 },
  ];
  for (const alert of readings.flatMap(ruleEngine)) {
    const message = buildSmsTemplate({
      farmerName: 'Farmer',
      farmName: 'Farm',
      tankName: 'Tank 1',
      severity: alert.severity,
      problem: alert.message,
      value: alert.currentValue,
      unit: alert.unit,
      action: alert.action,
      alertAt: new Date('2026-11-13T06:01:44.000Z'),
      sensors: buildSmsSensorLines({
        temperature: null,
        ph: alert.unit === 'pH' ? alert.currentValue : 7,
        dissolvedOxygen: alert.unit === 'mg/L' ? alert.currentValue : null,
        dissolvedOxygenMeasured: alert.unit === 'mg/L',
        turbidity: alert.unit === 'NTU' ? alert.currentValue : 20,
        turbidityUnit: 'NTU',
        orp: null,
      }),
    });
    assert.ok(message.length <= config.sms.maxMessageLength);
    assert.match(message, /When: /);
    assert.match(message, /Temp: Disconnected/);
    assert.match(message, /ORP: Disconnected/);
    assert.ok(message.endsWith('.'));
    assert.doesNotMatch(message, /EMERGENCY|CRITICAL|WARNING|AERATOR|DASHBOARD|https?:|www\./);
  }
});

test('combined alerts include sensor list and timestamp', () => {
  const message = buildCombinedAlertSmsTemplate({
    farmName: 'Farm',
    tankName: 'Tank 1',
    severity: 'EMERGENCY',
    problems: [
      { message: 'Dissolved oxygen dangerously low', value: 1.5, unit: 'mg/L' },
      { message: 'pH critically low', value: 5.8, unit: 'pH' },
      { message: 'Temperature dangerously high', value: 36, unit: 'C' },
    ],
    action: 'AERATOR_ON_IMMEDIATE',
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
    sensors: buildSmsSensorLines({
      temperature: 36,
      ph: 5.8,
      dissolvedOxygen: 1.5,
      dissolvedOxygenMeasured: true,
      turbidity: null,
      turbidityUnit: 'NTU',
      orp: null,
    }),
  });
  assert.ok(message.length <= config.sms.maxMessageLength);
  assert.match(message, /When: /);
  assert.match(message, /Temp: 36 C/);
  assert.match(message, /pH: 5\.80\b/);
  assert.doesNotMatch(message, /\bDO:/);
  assert.match(message, /Turbidity: Disconnected/);
  assert.ok(message.includes('Please turn on the aerator immediately.'));
});

test('generated messages omit links and normalize capitalized labels', () => {
  const message = buildSmsTemplate({
    farmerName: 'Farmer',
    farmName: 'NORTH FARM https://example.com',
    tankName: 'TANK ONE www.example.com',
    severity: 'CRITICAL',
    problem: 'pH critically low',
    value: 5.8,
    unit: 'pH',
    action: 'WATER_REPLACEMENT',
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
  });
  assert.doesNotMatch(message, /https?:|www\.|example\.com|NORTH|FARM|TANK/);
  assert.match(message, /pH/);
});

test('prediction wording preserves uncertainty and does not invent a time', () => {
  const message = buildPredictiveSmsTemplate({
    farmName: 'Farm',
    tankName: 'Tank 1',
    riskLevel: 'HIGH',
    cause: 'DO trending down',
    etaMinutes: null,
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
  });
  assert.ok(message.length <= config.sms.maxMessageLength);
  assert.match(message, /time to unsafe conditions is uncertain/);
  assert.doesNotMatch(message, /Unsafe soon|ETA|\bDO\b|HIGH/);
  const timed = buildPredictiveSmsTemplate({
    farmName: 'Farm',
    tankName: 'Tank 1',
    riskLevel: 'CRITICAL',
    cause: 'low dissolved oxygen',
    etaMinutes: 1,
    alertAt: new Date('2026-11-13T06:01:44.000Z'),
  });
  assert.match(timed, /may become unsafe in about 1 minute\./);
  assert.ok(timed.includes('Please check the tank now.'));
});

test('a missing UniSMS sender is explained without the raw provider payload', () => {
  const message = describeSmsFailure([smsResult('rejected', 0, { httpStatus: 422, errors: { sender_id: ['does not exists'] } })]);
  assert.match(message, /Unisoft/);
  assert.doesNotMatch(message, /does not exists/);
});

test('default SMS identifies a test without claiming sensor or delivery success', () => {
  assert.ok(validateSmsMessage(DEFAULT_TEST_SMS).valid);
  assert.match(DEFAULT_TEST_SMS, /notification test/);
  assert.match(DEFAULT_TEST_SMS, /No action is required\./);
  assert.doesNotMatch(DEFAULT_TEST_SMS, /system is online|successfully delivered|https?:|www\./);
});

test('formatSmsSensorLine shows Disconnected for null or disconnected sensors', () => {
  assert.equal(formatSmsSensorLine({ label: 'Temp', value: null, unit: 'C' }), 'Temp: Disconnected');
  assert.equal(formatSmsSensorLine({ label: 'Temp', value: 28, unit: 'C', connected: false }), 'Temp: Disconnected');
  assert.equal(formatSmsSensorLine({ label: 'pH', value: 7.2, unit: 'pH' }), 'pH: 7.20');
});
