import { WaterQualitySetting } from '../database/models/WaterQualitySetting';
import { logger } from '../utils/logger';

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

/** Growth guidance and the critical cuts already used by the alert rules. */
export const DEFAULT_THRESHOLD_BANDS: ThresholdBands = {
  temperature: { alertMin: 15, normalMin: 26, normalMax: 29, alertMax: 32 },
  ph: { alertMin: 6, normalMin: 7, normalMax: 8.5, alertMax: 8.5 },
  turbidity: { alertMin: null, normalMin: null, normalMax: 70, alertMax: 100 },
};

const LIMITS: Record<BandKey, { min: number; max: number; highOnly: boolean }> = {
  temperature: { min: 0, max: 50, highOnly: false },
  ph: { min: 0, max: 14, highOnly: false },
  turbidity: { min: 0, max: 10000, highOnly: true },
};

const finite = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

export const classifyBand = (value: number, band: ParameterBand): BandLevel => {
  if (!Number.isFinite(value)) return 'normal';
  if (band.alertMin != null && value < band.alertMin) return 'alert';
  if (band.alertMax != null && value > band.alertMax) return 'alert';
  if (band.normalMin != null && value < band.normalMin) return 'warning';
  if (band.normalMax != null && value > band.normalMax) return 'warning';
  return 'normal';
};

const inRange = (value: number | null, min: number, max: number): boolean =>
  value == null || (value >= min && value <= max);

export const thresholdBandIssue = (bands: ThresholdBands): string | null => {
  const keys: BandKey[] = ['temperature', 'ph', 'turbidity'];
  for (const key of keys) {
    const band = bands[key];
    const limit = LIMITS[key];
    const label = key === 'ph' ? 'pH' : key === 'temperature' ? 'Temperature' : 'Turbidity';
    if (!band) return `${label} limits are missing`;
    if (limit.highOnly && (band.alertMin != null || band.normalMin != null)) {
      return `${label} uses an upper limit only`;
    }
    if (!limit.highOnly && (band.alertMin == null || band.normalMin == null || band.normalMax == null || band.alertMax == null)) {
      return `Enter every ${label} limit`;
    }
    if (limit.highOnly && (band.normalMax == null || band.alertMax == null)) {
      return `Enter both ${label} limits`;
    }
    if (!inRange(band.alertMin, limit.min, limit.max) || !inRange(band.normalMin, limit.min, limit.max)
      || !inRange(band.normalMax, limit.min, limit.max) || !inRange(band.alertMax, limit.min, limit.max)) {
      return `${label} is outside ${limit.min}–${limit.max}`;
    }
    if (band.alertMin != null && band.normalMin != null && band.alertMin >= band.normalMin) {
      return `${label} alert below must be under the normal range`;
    }
    if (band.normalMin != null && band.normalMax != null && band.normalMin > band.normalMax) {
      return `${label} normal range is reversed`;
    }
    if (band.normalMax != null && band.alertMax != null && band.normalMax > band.alertMax) {
      return `${label} alert above must be at or above the normal range`;
    }
    if (band.alertMin != null && band.alertMax != null && band.alertMin >= band.alertMax) {
      return `${label} alert limits overlap`;
    }
  }
  return null;
};

const readBand = (value: unknown, highOnly: boolean): ParameterBand | null => {
  if (!value || typeof value !== 'object') return null;
  const raw = value as Record<string, unknown>;
  const band: ParameterBand = {
    alertMin: raw.alertMin === null ? null : finite(raw.alertMin),
    normalMin: raw.normalMin === null ? null : finite(raw.normalMin),
    normalMax: raw.normalMax === null ? null : finite(raw.normalMax),
    alertMax: raw.alertMax === null ? null : finite(raw.alertMax),
  };
  if (highOnly) {
    band.alertMin = null;
    band.normalMin = null;
  }
  return band;
};

export const loadThresholdBands = async (): Promise<ThresholdBands> => {
  try {
    if (!WaterQualitySetting.sequelize) return DEFAULT_THRESHOLD_BANDS;
    const row = await WaterQualitySetting.findByPk('bands');
    if (!row?.thresholds) return DEFAULT_THRESHOLD_BANDS;
    const stored = row.thresholds as unknown as Partial<ThresholdBands>;
    const bands: ThresholdBands = {
      temperature: readBand(stored.temperature, false) ?? DEFAULT_THRESHOLD_BANDS.temperature,
      ph: readBand(stored.ph, false) ?? DEFAULT_THRESHOLD_BANDS.ph,
      turbidity: readBand(stored.turbidity, true) ?? DEFAULT_THRESHOLD_BANDS.turbidity,
    };
    return thresholdBandIssue(bands) ? DEFAULT_THRESHOLD_BANDS : bands;
  } catch (error) {
    logger.warn('Could not load threshold bands', { error: error instanceof Error ? error.message : String(error) });
    return DEFAULT_THRESHOLD_BANDS;
  }
};

export const saveThresholdBands = async (bands: ThresholdBands): Promise<ThresholdBands> => {
  const issue = thresholdBandIssue(bands);
  if (issue) throw new Error(issue);
  await WaterQualitySetting.upsert({ id: 'bands', thresholds: bands as unknown as WaterQualitySetting['thresholds'] });
  return bands;
};
