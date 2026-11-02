import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { AmmoniaInputError, ammoniaPKa, calculateAmmonia, nh3Fraction } from './ammoniaCalculator';
import { ammoniaCalculationSchema, validateBody } from '../middleware/validate';
import { calculateAmmoniaSpeciation } from '../iot/water/controllers/waterController';

const close = (actual: number | null, expected: number, tolerance: number) =>
  assert.ok(actual !== null && Math.abs(actual - expected) <= tolerance, `expected ${expected}, got ${actual}`);

test('steps 2-4: 28 °C and pH 8.0 give pKa 9.155, fNH3 0.0654 and 6.54 %', () => {
  close(ammoniaPKa(28), 9.155, 0.001);
  close(nh3Fraction(ammoniaPKa(28), 8), 0.0654, 0.0001);
  const result = calculateAmmonia({ temperatureC: 28, ph: 8 });
  close(result.nh3Percent, 6.54, 0.01);
  assert.equal(result.tan, null);
  assert.equal(result.nh3N, null);
  assert.equal(result.concentrationUnit, 'mg/L as N');
});

test('step 6, option A: measured TAN gives NH3-N = TAN × fNH3', () => {
  const result = calculateAmmonia({ temperatureC: 28, ph: 8, measurement: { kind: 'TAN', value: 2 } });
  assert.equal(result.tan, 2);
  assert.equal(result.tanOrigin, 'measured');
  close(result.nh3N, 2 * result.nh3Fraction, 1e-12);
  assert.equal(result.nh3NOrigin, 'calculated');
});

test('step 6, option B: measured NH3-N gives TAN = NH3-N / fNH3', () => {
  const result = calculateAmmonia({ temperatureC: 28, ph: 8, measurement: { kind: 'NH3_N', value: 0.1308 } });
  assert.equal(result.nh3N, 0.1308);
  assert.equal(result.nh3NOrigin, 'measured');
  close(result.tan, 0.1308 / result.nh3Fraction, 1e-12);
  close(result.tan, 2, 0.01);
  assert.equal(result.tanOrigin, 'calculated');
});

test('options A and B are inverses of each other', () => {
  const a = calculateAmmonia({ temperatureC: 22.5, ph: 7.4, measurement: { kind: 'TAN', value: 1.7 } });
  const b = calculateAmmonia({ temperatureC: 22.5, ph: 7.4, measurement: { kind: 'NH3_N', value: a.nh3N! } });
  close(b.tan, 1.7, 1e-9);
});

test('rejects inputs outside the freshwater equation domain', () => {
  assert.throws(() => calculateAmmonia({ temperatureC: -127, ph: 8 }), AmmoniaInputError);
  assert.throws(() => calculateAmmonia({ temperatureC: 51, ph: 8 }), AmmoniaInputError);
  assert.throws(() => calculateAmmonia({ temperatureC: 28, ph: 14.5 }), AmmoniaInputError);
  assert.throws(() => calculateAmmonia({ temperatureC: 28, ph: Number.NaN }), AmmoniaInputError);
  assert.throws(() => calculateAmmonia({ temperatureC: 28, ph: 8, measurement: { kind: 'TAN', value: -1 } }), AmmoniaInputError);
});

test('POST /water/ammonia/calculate validates input and returns steps 2-6', async () => {
  const app = express();
  app.use(express.json());
  app.post('/water/ammonia/calculate', validateBody(ammoniaCalculationSchema), calculateAmmoniaSpeciation);
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/water/ammonia/calculate`;
  const post = async (body: unknown) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: response.status, body: await response.json() as { message: string; data?: any } };
  };
  try {
    const optionB = await post({ temperature: 28, ph: 8, nh3N: 0.1308 });
    assert.equal(optionB.status, 200);
    close(optionB.body.data.pKa, 9.155, 0.001);
    close(optionB.body.data.tan, 2, 0.01);
    assert.equal(optionB.body.data.tanOrigin, 'calculated');
    assert.equal((await post({ temperature: 28, ph: 8, tan: 1, nh3N: 1 })).status, 400);
    assert.equal((await post({ temperature: 28, ph: 8, tan: -1 })).status, 400);
    const outOfRange = await post({ temperature: -127, ph: 8 });
    assert.equal(outOfRange.status, 400);
    assert.match(outOfRange.body.message, /Temperature/);
  } finally {
    server.close();
  }
});
