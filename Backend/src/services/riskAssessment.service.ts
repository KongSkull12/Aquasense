import { sensorReadingService, type SensorReading } from './sensorReadingService';
import { tanMeasurementService } from './tanMeasurement.service';
import { isViolation, scoreRisk, trendOf, violationMinutesOf, type RiskFactor, type RiskLevel, type Trend } from './riskScoring';

export interface RiskAssessment {
  status: 'AVAILABLE' | 'UNAVAILABLE';
  reason?: string;
  score: number | null;
  worstCaseScore: number | null;
  level: RiskLevel | null;
  worstCaseLevel: RiskLevel | null;
  complete: boolean;
  factors: RiskFactor[];
  trends: { temperature: Trend; ammonia: Trend; orp: Trend; oxygen: Trend };
  violationMinutes: number | null;
  inputsUncalibrated: boolean;
  validation: 'NOT_FIELD_VALIDATED';
  readingAt: string | null;
  computedAt: string;
}

const LIVE_MS = 30_000;
const HISTORY_MINUTES = 60;
const TAN_MAX_AGE_MS = 24 * 3600_000;
const CACHE_MS = 10_000;

const finite = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const ntu = (reading: SensorReading): number | null => (reading.turbidityUnit === 'NTU' ? finite(reading.turbidity) : null);
const at = (reading: SensorReading): number => new Date(reading.timestamp).getTime();

const unavailable = (reason: string, readingAt: string | null = null): RiskAssessment => ({
  status: 'UNAVAILABLE', reason, score: null, worstCaseScore: null, level: null, worstCaseLevel: null, complete: false,
  factors: [], trends: { temperature: 'Unknown', ammonia: 'Unknown', orp: 'Unknown', oxygen: 'Unknown' },
  violationMinutes: null, inputsUncalibrated: true, validation: 'NOT_FIELD_VALIDATED', readingAt, computedAt: new Date().toISOString(),
});

const cache = new Map<string, { expires: number; value: RiskAssessment }>();

export const riskAssessmentService = {
  async assess(deviceIds?: string[]): Promise<RiskAssessment> {
    const key = deviceIds ? [...deviceIds].sort().join(',') : '*';
    const hit = cache.get(key);
    if (hit && hit.expires > Date.now()) return hit.value;
    const value = await this.compute(deviceIds);
    cache.set(key, { expires: Date.now() + CACHE_MS, value });
    return value;
  },

  async compute(deviceIds?: string[]): Promise<RiskAssessment> {
    const latest = await sensorReadingService.getLatestReading(deviceIds);
    if (!latest) return unavailable('No sensor readings yet');
    const readingAt = new Date(latest.timestamp).toISOString();
    if (Date.now() - at(latest) > LIVE_MS) return unavailable('The device is not sending live readings', readingAt);

    const history = (await sensorReadingService.getReadingsByTimeRange(HISTORY_MINUTES, deviceIds))
      .filter((reading) => reading.deviceId === latest.deviceId);
    const tans = (await tanMeasurementService.list(deviceIds ?? null, 2))
      .filter((tan) => tan.deviceId === latest.deviceId);
    const recentTan = tans[0] && Date.now() - new Date(tans[0].sampleCollectedAt).getTime() <= TAN_MAX_AGE_MS ? tans[0] : null;
    const ammoniaMgL = recentTan ? finite(Number(recentTan.value)) : null;
    const ammoniaTrend: Trend = recentTan && tans[1]
      ? (Number(tans[0].value) > Number(tans[1].value) * 1.1 ? 'Rising' : Number(tans[0].value) < Number(tans[1].value) * 0.9 ? 'Falling' : 'Stable')
      : 'Unknown';

    const series = (pick: (reading: SensorReading) => number | null) => history
      .map((reading) => ({ at: at(reading), value: pick(reading) }))
      .filter((sample): sample is { at: number; value: number } => sample.value !== null);
    const temperatureTrend = trendOf(series((r) => finite(r.temperature)), 0.5);
    const orpTrend = trendOf(series((r) => finite(r.orp)), 20);

    const violationMinutes = history.length >= 2
      ? violationMinutesOf(history.map((reading) => ({ at: at(reading), violated: isViolation({
        temperatureC: finite(reading.temperature), ph: finite(reading.ph), turbidityNtu: ntu(reading),
        orpMv: finite(reading.orp), ammoniaMgL }) })))
      : null;

    const result = scoreRisk({
      dissolvedOxygenMgL: null,
      ammoniaMgL,
      temperatureC: finite(latest.temperature),
      ph: finite(latest.ph),
      turbidityNtu: ntu(latest),
      orpMv: finite(latest.orp),
      violationMinutes,
      oxygenTrend: 'Unknown',
      ammoniaTrend,
      temperatureTrend,
    });
    const health = latest.sensorHealth;
    const inputsUncalibrated = (['temperature', 'ph', 'turbidity', 'orp'] as const)
      .some((name) => health?.[name] && health[name].calibration !== 'CALIBRATED');

    return {
      status: 'AVAILABLE', ...result,
      trends: { temperature: temperatureTrend, ammonia: ammoniaTrend, orp: orpTrend, oxygen: 'Unknown' },
      violationMinutes, inputsUncalibrated, validation: 'NOT_FIELD_VALIDATED', readingAt, computedAt: new Date().toISOString(),
    };
  },
};
