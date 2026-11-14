import assert from 'node:assert/strict';
import test from 'node:test';
import { classifyBand, DEFAULT_THRESHOLD_BANDS, thresholdBandIssue } from './thresholdBands';

test('temperature uses the growth range as Normal and the critical cuts as Alert', () => {
  const band = DEFAULT_THRESHOLD_BANDS.temperature;
  assert.equal(classifyBand(26, band), 'normal');
  assert.equal(classifyBand(29, band), 'normal');
  assert.equal(classifyBand(20, band), 'warning');
  assert.equal(classifyBand(30, band), 'warning');
  assert.equal(classifyBand(32, band), 'warning');
  assert.equal(classifyBand(14.9, band), 'alert');
  assert.equal(classifyBand(32.1, band), 'alert');
});

test('pH stays Normal through the culture guidance and Alerts at the critical cuts', () => {
  const band = DEFAULT_THRESHOLD_BANDS.ph;
  assert.equal(classifyBand(7, band), 'normal');
  assert.equal(classifyBand(8.5, band), 'normal');
  assert.equal(classifyBand(6.5, band), 'warning');
  assert.equal(classifyBand(5.9, band), 'alert');
  assert.equal(classifyBand(8.6, band), 'alert');
});

test('turbidity follows the existing alert-rule cuts', () => {
  const band = DEFAULT_THRESHOLD_BANDS.turbidity;
  assert.equal(classifyBand(70, band), 'normal');
  assert.equal(classifyBand(71, band), 'warning');
  assert.equal(classifyBand(100, band), 'warning');
  assert.equal(classifyBand(100.1, band), 'alert');
});

test('water depth uses the crayfish shallow-tub defaults', () => {
  const band = DEFAULT_THRESHOLD_BANDS.waterDepth;
  assert.equal(classifyBand(3.0, band), 'normal');
  assert.equal(classifyBand(2.5, band), 'warning');
  assert.equal(classifyBand(1.9, band), 'alert');
  assert.equal(classifyBand(3.5, band), 'warning');
  assert.equal(classifyBand(4.1, band), 'alert');
});

test('ORP uses the starting freshwater redox band', () => {
  const band = DEFAULT_THRESHOLD_BANDS.orp;
  assert.equal(classifyBand(300, band), 'normal');
  assert.equal(classifyBand(100, band), 'warning');
  assert.equal(classifyBand(49, band), 'alert');
  assert.equal(classifyBand(600, band), 'warning');
  assert.equal(classifyBand(701, band), 'alert');
});

test('saved limits must keep Normal inside Alert', () => {
  assert.equal(thresholdBandIssue(DEFAULT_THRESHOLD_BANDS), null);
  const reversed = {
    ...DEFAULT_THRESHOLD_BANDS,
    temperature: { ...DEFAULT_THRESHOLD_BANDS.temperature, normalMin: 30, normalMax: 26 },
  };
  assert.match(thresholdBandIssue(reversed) || '', /Temperature normal range is reversed/);
  const wide = {
    ...DEFAULT_THRESHOLD_BANDS,
    ph: { ...DEFAULT_THRESHOLD_BANDS.ph, alertMax: 15 },
  };
  assert.match(thresholdBandIssue(wide) || '', /pH is outside 0–14/);
  const missingOrp = {
    temperature: DEFAULT_THRESHOLD_BANDS.temperature,
    ph: DEFAULT_THRESHOLD_BANDS.ph,
    turbidity: DEFAULT_THRESHOLD_BANDS.turbidity,
    waterDepth: DEFAULT_THRESHOLD_BANDS.waterDepth,
  } as typeof DEFAULT_THRESHOLD_BANDS;
  assert.match(thresholdBandIssue(missingOrp) || '', /ORP/);
});
