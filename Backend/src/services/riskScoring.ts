/**
 * Mortality-risk scoring + trend analysis (study Objective 2).
 *
 * Points follow the study's "Risk scoring + trend" model. AquaSense adaptations:
 *  - Dissolved oxygen has no probe, so its points are reported as missing, never as 0.
 *  - Ammonia comes from manually entered TAN measurements (mg/L as N), when recent.
 *  - ORP is an AquaSense addition with PROVISIONAL thresholds (not in the study dataset).
 * Missing inputs widen the result into a level range so an incomplete score is never
 * presented as "Low". The score is not validated against field mortality data.
 */

export type RiskLevel = 'Low' | 'Moderate' | 'High' | 'Extreme';
export type Trend = 'Rising' | 'Falling' | 'Stable' | 'Unknown';
export type RiskFactorKey = 'dissolvedOxygen' | 'ammonia' | 'temperature' | 'ph' | 'turbidity' | 'orp' | 'violationDuration';

export interface RiskInputs {
  dissolvedOxygenMgL: number | null;
  ammoniaMgL: number | null;
  temperatureC: number | null;
  ph: number | null;
  turbidityNtu: number | null;
  orpMv: number | null;
  violationMinutes: number | null;
  oxygenTrend: Trend;
  ammoniaTrend: Trend;
  temperatureTrend: Trend;
}

export interface RiskFactor {
  key: RiskFactorKey;
  label: string;
  value: number | null;
  unit: string;
  points: number;
  maxPoints: number;
  available: boolean;
  provisional: boolean;
  detail: string;
}

export interface RiskScore {
  score: number;              // from available inputs, capped at 100
  worstCaseScore: number;     // if every missing input were at its worst
  level: RiskLevel;
  worstCaseLevel: RiskLevel;
  complete: boolean;
  factors: RiskFactor[];
  violation: boolean;
}

export const RISK_THRESHOLDS = {
  // "Violation" limits from the study's threshold model; ORP limit is provisional.
  dissolvedOxygenBelow: 4.5, ammoniaAbove: 2.0, temperatureAbove: 32, phBelow: 6.5, phAbove: 8.5, turbidityAbove: 70,
  orpBelow: 100,
} as const;

export const classifyRisk = (score: number): RiskLevel =>
  score <= 30 ? 'Low' : score <= 55 ? 'Moderate' : score <= 80 ? 'High' : 'Extreme';

const band = (steps: Array<[boolean, number]>): number => steps.find(([hit]) => hit)?.[1] ?? 0;

export const isViolation = (r: { dissolvedOxygenMgL?: number | null; ammoniaMgL?: number | null; temperatureC?: number | null;
  ph?: number | null; turbidityNtu?: number | null; orpMv?: number | null }): boolean => {
  const t = RISK_THRESHOLDS;
  return (r.dissolvedOxygenMgL != null && r.dissolvedOxygenMgL < t.dissolvedOxygenBelow)
    || (r.ammoniaMgL != null && r.ammoniaMgL > t.ammoniaAbove)
    || (r.temperatureC != null && r.temperatureC > t.temperatureAbove)
    || (r.ph != null && (r.ph < t.phBelow || r.ph > t.phAbove))
    || (r.turbidityNtu != null && r.turbidityNtu > t.turbidityAbove)
    || (r.orpMv != null && r.orpMv < t.orpBelow);
};

export const scoreRisk = (input: RiskInputs): RiskScore => {
  const factors: RiskFactor[] = [];
  const add = (factor: Omit<RiskFactor, 'available' | 'points'> & { points: number | null }) => {
    factors.push({ ...factor, available: factor.points !== null, points: factor.points ?? 0 });
  };

  const doValue = input.dissolvedOxygenMgL;
  add({ key: 'dissolvedOxygen', label: 'Dissolved oxygen', value: doValue, unit: 'mg/L', maxPoints: 43, provisional: false,
    points: doValue === null ? null
      : band([[doValue < 3, 35], [doValue < 4, 20], [doValue < 5, 10]]) + (input.oxygenTrend === 'Falling' ? 8 : 0),
    detail: doValue === null ? 'No dissolved-oxygen probe installed' : `Trend ${input.oxygenTrend.toLowerCase()}` });

  const am = input.ammoniaMgL;
  add({ key: 'ammonia', label: 'Ammonia (TAN)', value: am, unit: 'mg/L', maxPoints: 38, provisional: false,
    points: am === null ? null
      : band([[am > 5, 30], [am > 3, 20], [am > 1.5, 10]]) + (input.ammoniaTrend === 'Rising' ? 8 : 0),
    detail: am === null ? 'No recent TAN measurement entered' : `From manual TAN entry, trend ${input.ammoniaTrend.toLowerCase()}` });

  const temp = input.temperatureC;
  add({ key: 'temperature', label: 'Temperature', value: temp, unit: '°C', maxPoints: 30, provisional: false,
    points: temp === null ? null
      : band([[temp > 35, 25], [temp > 32, 15], [temp > 30, 8]]) + (input.temperatureTrend === 'Rising' ? 5 : 0),
    detail: temp === null ? 'No live temperature' : `Trend ${input.temperatureTrend.toLowerCase()}` });

  const ph = input.ph;
  add({ key: 'ph', label: 'pH', value: ph, unit: '', maxPoints: 20, provisional: false,
    points: ph === null ? null : band([[ph < 6 || ph > 8.5, 20], [ph < 6.5 || ph > 8.0, 10]]),
    detail: ph === null ? 'No live pH' : 'Penalised below 6.5 or above 8.0' });

  const tu = input.turbidityNtu;
  add({ key: 'turbidity', label: 'Turbidity', value: tu, unit: 'NTU', maxPoints: 15, provisional: false,
    points: tu === null ? null : band([[tu > 80, 15], [tu > 60, 8]]),
    detail: tu === null ? 'No live NTU reading' : 'Penalised above 60 NTU' });

  const orp = input.orpMv;
  add({ key: 'orp', label: 'ORP / redox', value: orp, unit: 'mV', maxPoints: 15, provisional: true,
    points: orp === null ? null : band([[orp < 100, 15], [orp < 200, 8]]),
    detail: orp === null ? 'No live ORP reading' : 'Provisional AquaSense limits (below 200 mV)' });

  const minutes = input.violationMinutes;
  add({ key: 'violationDuration', label: 'Time out of range', value: minutes, unit: 'min', maxPoints: 25, provisional: false,
    points: minutes === null ? null : band([[minutes > 60, 25], [minutes > 30, 15], [minutes > 15, 8]]),
    detail: minutes === null ? 'Not enough history' : 'Continuous minutes any parameter was out of range' });

  const available = factors.filter((f) => f.available).reduce((sum, f) => sum + f.points, 0);
  const missingMax = factors.filter((f) => !f.available).reduce((sum, f) => sum + f.maxPoints, 0);
  const score = Math.min(100, available);
  const worstCaseScore = Math.min(100, available + missingMax);
  return {
    score, worstCaseScore,
    level: classifyRisk(score), worstCaseLevel: classifyRisk(worstCaseScore),
    complete: missingMax === 0, factors,
    violation: isViolation({ dissolvedOxygenMgL: doValue, ammoniaMgL: am, temperatureC: temp, ph, turbidityNtu: tu, orpMv: orp }),
  };
};

/** Trend from the change between the first and last samples of a window; Unknown when too short. */
export const trendOf = (samples: Array<{ at: number; value: number }>, threshold: number, minSpanMs = 10 * 60_000): Trend => {
  if (samples.length < 3) return 'Unknown';
  const sorted = [...samples].sort((a, b) => a.at - b.at);
  if (sorted[sorted.length - 1].at - sorted[0].at < minSpanMs) return 'Unknown';
  const head = sorted.slice(0, Math.max(1, Math.floor(sorted.length / 5)));
  const tail = sorted.slice(-Math.max(1, Math.floor(sorted.length / 5)));
  const mean = (list: typeof sorted) => list.reduce((s, x) => s + x.value, 0) / list.length;
  const change = mean(tail) - mean(head);
  return change >= threshold ? 'Rising' : change <= -threshold ? 'Falling' : 'Stable';
};

/** Continuous minutes (ending at the newest sample) during which `violated` held; gaps over maxGapMs break the run. */
export const violationMinutesOf = (samples: Array<{ at: number; violated: boolean }>, maxGapMs = 5 * 60_000): number => {
  const sorted = [...samples].sort((a, b) => b.at - a.at);
  if (!sorted.length || !sorted[0].violated) return 0;
  let start = sorted[0].at;
  for (let i = 1; i < sorted.length; i++) {
    if (!sorted[i].violated || sorted[i - 1].at - sorted[i].at > maxGapMs) break;
    start = sorted[i].at;
  }
  return Math.round((sorted[0].at - start) / 60_000);
};
