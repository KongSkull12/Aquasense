import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidSmsRecipient, validateSmsMessage } from './sms.service';
import { buildCombinedAlertSmsTemplate, buildPredictiveSmsTemplate, buildSmsTemplate, DEFAULT_TEST_SMS } from './smsTemplate.service';
import { ruleEngine } from './ruleEngine.service';

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

test('rejects messages over 160 characters', () => {
  const longMessage = 'A'.repeat(161);
  const result = validateSmsMessage(longMessage);
  assert.equal(result.valid, false);
});

test('accepts message with max 160 characters', () => {
  const message = 'A'.repeat(160);
  const result = validateSmsMessage(message);
  assert.equal(result.valid, true);
});

test('rule alert template fits SMS length limit', () => {
  const message = buildSmsTemplate({
    farmerName: 'Tessie',
    farmName: 'AquaSense Farm With A Long Name',
    tankName: 'FirstTank',
    severity: 'CRITICAL',
    problem: 'Dissolved oxygen critically low',
    value: 2.8,
    unit: 'mg/L',
    action: 'AERATOR_ON_IMMEDIATE',
  });

  assert.equal(message.length <= 160, true);
  assert.equal(validateSmsMessage(message).valid, true);
});

test('predictive alert template fits SMS length limit', () => {
  const message = buildPredictiveSmsTemplate({
    farmName: 'AquaSense Farm With A Long Name',
    tankName: 'FirstTank',
    riskLevel: 'CRITICAL',
    cause: 'low dissolved oxygen + elevated ammonia + DO trending down',
    etaMinutes: 12,
  });

  assert.equal(message.length <= 160, true);
  assert.equal(validateSmsMessage(message).valid, true);
});

test('long labels do not cut off the emergency action or measurement', () => {
  const message = buildSmsTemplate({
    farmerName: 'Farmer', farmName: 'Very long farm name '.repeat(20), tankName: 'Very long tank name '.repeat(20),
    severity: 'EMERGENCY', problem: 'Dissolved oxygen dangerously low', value: 1.5, unit: 'mg/L', action: 'AERATOR_ON_IMMEDIATE',
  });
  assert.ok(message.length <= 160);
  assert.match(message, /emergency alert/);
  assert.match(message, /1\.5 mg\/L/);
  assert.ok(message.endsWith('Please turn on the aerator immediately.'));
  assert.doesNotMatch(message, /\.\.\.|EMERGENCY|\|/);
});

test('all rule-generated messages preserve readings, units and complete sentences', () => {
  const readings = [
    { temperature: 9, ph: 5.8, dissolvedOxygen: 1.5, turbidity: 110, ammonia: 8 },
    { temperature: 14, ph: 6.3, dissolvedOxygen: 2.8, turbidity: 80, ammonia: 6 },
    { temperature: 36, ph: 8.8, dissolvedOxygen: 4, turbidity: 20, ammonia: 3 },
    { temperature: 33, ph: 8.3, dissolvedOxygen: 6, turbidity: 20, ammonia: 0 },
    { temperature: 30, ph: 7, dissolvedOxygen: 6, turbidity: 20, ammonia: 0 },
  ];
  for (const alert of readings.flatMap(ruleEngine)) {
    const message = buildSmsTemplate({ farmerName: 'Farmer', farmName: 'Farm', tankName: 'Tank 1',
      severity: alert.severity, problem: alert.message, value: alert.currentValue, unit: alert.unit, action: alert.action });
    assert.ok(message.length <= 160);
    assert.ok(message.includes(`${alert.currentValue} ${alert.unit}`));
    assert.ok(message.endsWith('.'));
    assert.doesNotMatch(message, /EMERGENCY|CRITICAL|WARNING|AERATOR|DASHBOARD|https?:|www\.|\.\.\./);
  }
});

test('combined alerts direct farmers to remaining alerts when all details cannot fit', () => {
  const message = buildCombinedAlertSmsTemplate({ farmName: 'Farm', tankName: 'Tank 1', severity: 'EMERGENCY',
    problems: [
      { message: 'Dissolved oxygen dangerously low', value: 1.5, unit: 'mg/L' },
      { message: 'pH critically low', value: 5.8, unit: 'pH' },
      { message: 'Temperature dangerously high', value: 36, unit: 'C' },
    ], action: 'AERATOR_ON_IMMEDIATE' });
  assert.ok(message.length <= 160);
  assert.match(message, /1\.5 mg\/L/);
  assert.match(message, /other alerts in the dashboard/);
  assert.ok(message.endsWith('Please turn on the aerator immediately.'));
});

test('generated messages omit links and normalize capitalized labels', () => {
  const message = buildSmsTemplate({ farmerName: 'Farmer', farmName: 'NORTH FARM https://example.com',
    tankName: 'TANK ONE www.example.com', severity: 'CRITICAL', problem: 'pH critically low', value: 5.8, unit: 'pH', action: 'WATER_REPLACEMENT' });
  assert.doesNotMatch(message, /https?:|www\.|example\.com|NORTH|FARM|TANK/);
  assert.match(message, /pH/);
});

test('prediction wording preserves uncertainty and does not invent a time', () => {
  const message = buildPredictiveSmsTemplate({ farmName: 'Farm', tankName: 'Tank 1', riskLevel: 'HIGH', cause: 'DO trending down', etaMinutes: null });
  assert.ok(message.length <= 160);
  assert.match(message, /time to unsafe conditions is uncertain/);
  assert.doesNotMatch(message, /Unsafe soon|ETA|\bDO\b|HIGH/);
  const timed = buildPredictiveSmsTemplate({ farmName: 'Farm', tankName: 'Tank 1', riskLevel: 'CRITICAL', cause: 'low dissolved oxygen', etaMinutes: 1 });
  assert.match(timed, /may become unsafe in about 1 minute\./);
  assert.ok(timed.endsWith('Please check the tank now.'));
});

test('default SMS identifies a test without claiming sensor or delivery success', () => {
  assert.ok(validateSmsMessage(DEFAULT_TEST_SMS).valid);
  assert.match(DEFAULT_TEST_SMS, /notification test/);
  assert.match(DEFAULT_TEST_SMS, /No action is required\./);
  assert.doesNotMatch(DEFAULT_TEST_SMS, /system is online|successfully delivered|https?:|www\./);
});
