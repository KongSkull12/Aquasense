export type BandLevel = 'normal' | 'warning' | 'alert';
export type BandKey = 'temperature' | 'ph' | 'turbidity';

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
}

/** Same defaults as Backend/src/services/thresholdBands.ts. */
export const DEFAULT_THRESHOLD_BANDS: ThresholdBands = {
  temperature: { alertMin: 15, normalMin: 26, normalMax: 29, alertMax: 32 },
  ph: { alertMin: 6, normalMin: 7, normalMax: 8.5, alertMax: 8.5 },
  turbidity: { alertMin: null, normalMin: null, normalMax: 70, alertMax: 100 },
};

export const classifyBand = (value: number, band: ParameterBand): BandLevel => {
  if (!Number.isFinite(value)) return 'normal';
  if (band.alertMin != null && value < band.alertMin) return 'alert';
  if (band.alertMax != null && value > band.alertMax) return 'alert';
  if (band.normalMin != null && value < band.normalMin) return 'warning';
  if (band.normalMax != null && value > band.normalMax) return 'warning';
  return 'normal';
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
