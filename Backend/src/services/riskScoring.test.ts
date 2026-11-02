import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyRisk, isViolation, scoreRisk, trendOf, violationMinutesOf, type RiskInputs } from './riskScoring';

const full: RiskInputs = {
  dissolvedOxygenMgL: 2.5, ammoniaMgL: 6, temperatureC: 36, ph: 5.8, turbidityNtu: 90, orpMv: null,
  violationMinutes: 70, oxygenTrend: 'Falling', ammoniaTrend: 'Rising', temperatureTrend: 'Rising',
};

test('study points and trend bonuses match the reference model, capped at 100', () => {
  const r = scoreRisk({ ...full, orpMv: 300 });
  const points = Object.fromEntries(r.factors.map((f) => [f.key, f.points]));
  assert.deepEqual(points, { dissolvedOxygen: 43, ammonia: 38, temperature: 30, ph: 20, turbidity: 15, orp: 0, violationDuration: 25 });
  assert.equal(r.score, 100);
  assert.equal(r.level, 'Extreme');
  assert.equal(r.complete, true);
});

test('classification bands follow the study cut-offs', () => {
  assert.deepEqual([30, 31, 55, 56, 80, 81].map(classifyRisk), ['Low', 'Moderate', 'Moderate', 'High', 'High', 'Extreme']);
});

test('missing DO and ammonia widen the level instead of reporting Low', () => {
  const r = scoreRisk({ ...full, dissolvedOxygenMgL: null, ammoniaMgL: null, temperatureC: 28, ph: 7.2, turbidityNtu: 20,
    orpMv: 300, violationMinutes: 0, temperatureTrend: 'Stable' });
  assert.equal(r.score, 0);
  assert.equal(r.level, 'Low');
  assert.equal(r.complete, false);
  assert.equal(r.worstCaseScore, 81);   // 43 (DO) + 38 (ammonia) could still be missing
  assert.equal(r.worstCaseLevel, 'Extreme');
  assert.equal(r.factors.find((f) => f.key === 'dissolvedOxygen')?.available, false);
});

test('provisional ORP limits add points', () => {
  const low = scoreRisk({ ...full, orpMv: 80 }).factors.find((f) => f.key === 'orp');
  assert.equal(low?.points, 15);
  assert.equal(low?.provisional, true);
});

test('violation duration counts the newest continuous run and breaks on gaps', () => {
  const t = 1_000_000_000;
  const run = [0, 5, 10, 15, 20].map((m) => ({ at: t - m * 60_000, violated: true }));
  assert.equal(violationMinutesOf([...run, { at: t - 25 * 60_000, violated: false }]), 20);
  assert.equal(violationMinutesOf([{ at: t, violated: true }, { at: t - 30 * 60_000, violated: true }]), 0);
  assert.equal(violationMinutesOf([{ at: t, violated: false }, ...run.slice(1)]), 0);
  assert.equal(isViolation({ temperatureC: 33 }), true);
  assert.equal(isViolation({ temperatureC: 28, ph: 7.4, turbidityNtu: 20 }), false);
});

test('trends need enough history and compare the start and end of the window', () => {
  const t = 1_000_000_000;
  const rising = Array.from({ length: 20 }, (_, i) => ({ at: t + i * 60_000, value: 27 + i * 0.1 }));
  assert.equal(trendOf(rising, 0.5), 'Rising');
  assert.equal(trendOf(rising.map((s) => ({ ...s, value: 27 })), 0.5), 'Stable');
  assert.equal(trendOf(rising.slice(0, 2), 0.5), 'Unknown');
});
