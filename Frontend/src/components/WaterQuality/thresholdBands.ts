export type BandLevel = 'normal' | 'warning' | 'alert';
export type BandKey = 'temperature' | 'ph' | 'turbidity' | 'waterDepth';

export interface ParameterBand {
  alertMin: number | null;
  normalMin: number | null;
  normalMax: number | null;
  alertMax: number | null;
}

export interface ThresholdBands {
  temperature: ParameterBand;
  ph: ParameterBand;
  turbidity: ParameterBand;
  waterDepth: ParameterBand;
}

/** Same defaults as Backend/src/services/thresholdBands.ts. */
export const DEFAULT_THRESHOLD_BANDS: ThresholdBands = {
  temperature: { alertMin: 15, normalMin: 26, normalMax: 29, alertMax: 32 },
  ph: { alertMin: 6, normalMin: 7, normalMax: 8.5, alertMax: 8.5 },
  turbidity: { alertMin: null, normalMin: null, normalMax: 70, alertMax: 100 },
  waterDepth: { alertMin: 2.0, normalMin: 2.7, normalMax: 3.3, alertMax: 4.0 },
};

export const classifyBand = (value: number, band: ParameterBand): BandLevel => {
  if (!Number.isFinite(value)) return 'normal';
  if (band.alertMin != null && value < band.alertMin) return 'alert';
  if (band.alertMax != null && value > band.alertMax) return 'alert';
  if (band.normalMin != null && value < band.normalMin) return 'warning';
  if (band.normalMax != null && value > band.normalMax) return 'warning';
  return 'normal';
};

const BAND_LIMITS: Record<BandKey, { min: number; max: number; highOnly: boolean }> = {
  temperature: { min: 0, max: 50, highOnly: false },
  ph: { min: 0, max: 14, highOnly: false },
  turbidity: { min: 0, max: 10000, highOnly: true },
  waterDepth: { min: 0, max: 200, highOnly: false },
};

/** Instant form feedback. Same rules as thresholdBandIssue in the backend, which still has the final say. */
export const bandIssue = (key: BandKey, band: ParameterBand): string | null => {
  const { min, max, highOnly } = BAND_LIMITS[key];
  const { alertMin, normalMin, normalMax, alertMax } = band;
  const required = highOnly ? [normalMax, alertMax] : [alertMin, normalMin, normalMax, alertMax];
  if (required.some((value) => value == null)) return 'Enter every limit.';
  if (required.some((value) => value! < min || value! > max)) return `Use values from ${min} to ${max}.`;
  if (alertMin != null && normalMin != null && alertMin >= normalMin) return 'The low alert must be below the normal range.';
  if (normalMin != null && normalMax != null && normalMin > normalMax) return 'The normal range is reversed.';
  if (normalMax != null && alertMax != null && normalMax > alertMax) return 'The high alert cannot be below the normal range.';
  if (alertMin != null && alertMax != null && alertMin >= alertMax) return 'The alert limits overlap.';
  return null;
};

export const bandLabel = (level: BandLevel): 'Normal' | 'Warning' | 'Alert' =>
  level === 'normal' ? 'Normal' : level === 'warning' ? 'Warning' : 'Alert';

export const formatNormalBand = (band: ParameterBand, digits: number, unit: string): string => {
  const suffix = unit ? ` ${unit}` : '';
  if (band.normalMin != null && band.normalMax != null) {
    return `${band.normalMin.toFixed(digits)}–${band.normalMax.toFixed(digits)}${suffix}`;
  }
  if (band.normalMax != null) return `at or below ${band.normalMax.toFixed(digits)}${suffix}`;
  return 'not set';
};
