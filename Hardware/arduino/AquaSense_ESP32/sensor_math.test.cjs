/**
 * Mathematical harness for AquaSense conversion formulas (no hardware).
 * Run: node sensor_math.test.cjs
 */
const test = require('node:test');
const assert = require('node:assert/strict');

/** SEN0165 wiki equation rewritten for measured module output voltage. */
function orpFromSensorVoltage(sensorVolts, moduleSupplyV = 5.0, offset = 0) {
  return 400 * moduleSupplyV - 1000 * sensorVolts - offset;
}

/** pH/V slope with Nernst scaling of the pH-per-volt coefficient. */
function phFromSensorVoltage(sensorVolts, slope25, offset, tempC = null) {
  let slope = slope25;
  if (tempC != null && Number.isFinite(tempC)) {
    slope = slope25 * (298.15 / (tempC + 273.15));
  }
  return sensorVolts * slope + offset;
}

function turbidityFromSensorVoltage(sensorVolts, slope, offset) {
  if (!slope) return null;
  return slope * sensorVolts + offset;
}

test('SEN0165: mid-scale ~2.5 V module out near 0 mV before offset', () => {
  // 400*5 - 1000*2.5 = 2000 - 2500 = -500 mV at 2.5 V (circuit mid is not 0).
  // Zero of the circuit is at V = 0.4 * Vmod = 2.0 V: 400*5 - 1000*2 = 0.
  assert.equal(orpFromSensorVoltage(2.0, 5.0, 0), 0);
  assert.equal(orpFromSensorVoltage(1.5, 5.0, 0), 500);
  assert.equal(orpFromSensorVoltage(2.5, 5.0, 0), -500);
});

test('SEN0165: OFFSET shifts the reading without changing the circuit gain', () => {
  const raw = orpFromSensorVoltage(2.0, 5.0, 0);
  assert.equal(raw, 0);
  assert.equal(orpFromSensorVoltage(2.0, 5.0, 8), -8);
});

test('SEN0165: reconstructed divider voltage must be used', () => {
  // If a 2:1 divider is present, ADC sees 1.0 V when module outs 2.0 V.
  const vadc = 1.0;
  const divider = 2.0;
  const vsensor = vadc * divider;
  assert.equal(orpFromSensorVoltage(vsensor, 5.0, 0), 0);
  assert.notEqual(orpFromSensorVoltage(vadc, 5.0, 0), 0);
});

test('pH/V Nernst: warmer water shrinks pH per volt (electrode mV/pH grows)', () => {
  const slope25 = -5.7;
  const at25 = phFromSensorVoltage(2.5, slope25, 21.34, 25);
  const at35 = phFromSensorVoltage(2.5, slope25, 21.34, 35);
  // Same voltage → slightly different pH when T-compensated; |slope| smaller at 35 °C.
  const slope35 = slope25 * (298.15 / (35 + 273.15));
  assert.ok(Math.abs(slope35) < Math.abs(slope25));
  assert.notEqual(at25, at35);
});

test('pH two-point fit recovers slope and offset', () => {
  // Synthetic: pH = -5.7 * V + 21.34
  const v7 = (7 - 21.34) / -5.7;
  const v4 = (4 - 21.34) / -5.7;
  const n = 2;
  const sx = v7 + v4, sy = 7 + 4, sxx = v7 * v7 + v4 * v4, sxy = v7 * 7 + v4 * 4;
  const d = n * sxx - sx * sx;
  const slope = (n * sxy - sx * sy) / d;
  const offset = (sy - slope * sx) / n;
  assert.ok(Math.abs(slope + 5.7) < 1e-6);
  assert.ok(Math.abs(offset - 21.34) < 1e-6);
});

test('AstroC turbidity: uncalibrated slope yields no NTU', () => {
  assert.equal(turbidityFromSensorVoltage(2.5, 0, 0), null);
});

test('AstroC turbidity: linear voltage model', () => {
  // Example fit only — not a manufacturer curve.
  const slope = -400; // NTU per volt
  const offset = 1200;
  assert.equal(turbidityFromSensorVoltage(3.0, slope, offset), 0);
  assert.equal(turbidityFromSensorVoltage(2.0, slope, offset), 400);
});

console.log('sensor_math tests finished');
