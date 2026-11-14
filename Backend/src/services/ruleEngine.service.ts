import { refreshHealth, type HealthSummary } from './sensorHealth';
import { classifyBand, DEFAULT_THRESHOLD_BANDS, type ParameterBand, type ThresholdBands } from './thresholdBands';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
export type AlertCategory =
  | 'TEMP_HIGH'
  | 'TEMP_LOW'
  | 'PH_LOW'
  | 'PH_HIGH'
  | 'DO_LOW'
  | 'TURBIDITY_HIGH'
  | 'ORP_LOW'
  | 'ORP_HIGH'
  | 'AMMONIA_HIGH';
export type AlertAction =
  | 'DASHBOARD_ONLY'
  | 'WATER_CHANGE'
  | 'WATER_REPLACEMENT'
  | 'AERATOR_ON'
  | 'AERATOR_ON_IMMEDIATE';

export interface RuleAlertResult {
  category: AlertCategory;
  severity: AlertSeverity;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  action: AlertAction;
  message: string;
}

export interface RuleEngineInput {
  temperature: number | null;
  ph: number | null;
  dissolvedOxygen: number | null;
  dissolvedOxygenMeasured?: boolean;
  turbidity: number | null;
  ammonia?: number | null;
  orp?: number | null;
  sensorHealth?: HealthSummary;
  turbidityUnit?: string;
  /** Saved dashboard Thresholds — same Normal/Warning/Alert cuts as Overview. */
  thresholdBands?: ThresholdBands;
}

/** Every commissioned water-quality sensor alert that can open a dashboard row and SMS. */
export interface SensorAlertCatalogEntry {
  category: AlertCategory;
  sensor: string;
  unit: string;
  autoSms: boolean;
  triggers: Array<{ severity: AlertSeverity; when: string; limit: string }>;
}

export const SENSOR_ALERT_CATALOG: SensorAlertCatalogEntry[] = [
  {
    category: 'TEMP_LOW',
    sensor: 'Temperature',
    unit: 'C',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Below Thresholds normal', limit: 'Thresholds normal min' },
      { severity: 'CRITICAL', when: 'Below Thresholds alert', limit: 'Thresholds alert min' },
      { severity: 'EMERGENCY', when: 'Dangerously low', limit: '< 10' },
    ],
  },
  {
    category: 'TEMP_HIGH',
    sensor: 'Temperature',
    unit: 'C',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above Thresholds normal', limit: 'Thresholds normal max' },
      { severity: 'CRITICAL', when: 'Above Thresholds alert', limit: 'Thresholds alert max' },
      { severity: 'EMERGENCY', when: 'Dangerously high', limit: '> 35' },
    ],
  },
  {
    category: 'PH_LOW',
    sensor: 'pH',
    unit: 'pH',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Below Thresholds normal', limit: 'Thresholds normal min' },
      { severity: 'CRITICAL', when: 'Below Thresholds alert', limit: 'Thresholds alert min' },
    ],
  },
  {
    category: 'PH_HIGH',
    sensor: 'pH',
    unit: 'pH',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above Thresholds normal', limit: 'Thresholds normal max' },
      { severity: 'CRITICAL', when: 'Above Thresholds alert', limit: 'Thresholds alert max' },
    ],
  },
  {
    category: 'TURBIDITY_HIGH',
    sensor: 'Turbidity',
    unit: 'NTU',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above Thresholds normal', limit: 'Thresholds normal max' },
      { severity: 'CRITICAL', when: 'Above Thresholds alert', limit: 'Thresholds alert max' },
    ],
  },
  {
    category: 'DO_LOW',
    sensor: 'Dissolved oxygen',
    unit: 'mg/L',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Below ideal range', limit: '< 5' },
      { severity: 'CRITICAL', when: 'Critically low', limit: '< 3' },
      { severity: 'EMERGENCY', when: 'Dangerously low', limit: '< 2' },
    ],
  },
  {
    category: 'ORP_LOW',
    sensor: 'ORP / redox',
    unit: 'mV',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Below Thresholds normal', limit: 'Thresholds normal min' },
      { severity: 'CRITICAL', when: 'Below Thresholds alert', limit: 'Thresholds alert min' },
    ],
  },
  {
    category: 'ORP_HIGH',
    sensor: 'ORP / redox',
    unit: 'mV',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above Thresholds normal', limit: 'Thresholds normal max' },
      { severity: 'CRITICAL', when: 'Above Thresholds alert', limit: 'Thresholds alert max' },
    ],
  },
];

const bandIsHigh = (value: number, band: ParameterBand): boolean => {
  if (band.normalMin == null && band.alertMin == null) return true; // high-only (turbidity)
  if (band.alertMax != null && value > band.alertMax) return true;
  if (band.normalMax != null && value > band.normalMax) return true;
  return false;
};

const bandThresholdValue = (value: number, band: ParameterBand, level: 'warning' | 'alert', high: boolean): number => {
  if (high) {
    return level === 'alert'
      ? (band.alertMax ?? band.normalMax ?? value)
      : (band.normalMax ?? band.alertMax ?? value);
  }
  return level === 'alert'
    ? (band.alertMin ?? band.normalMin ?? value)
    : (band.normalMin ?? band.alertMin ?? value);
};

const bandAlert = (input: {
  value: number;
  band: ParameterBand;
  unit: string;
  lowCategory: AlertCategory;
  highCategory: AlertCategory;
  criticalAction: AlertAction;
  lowLabel: string;
  highLabel: string;
}): RuleAlertResult | null => {
  const level = classifyBand(input.value, input.band);
  if (level === 'normal') return null;
  const high = bandIsHigh(input.value, input.band);
  const severity: AlertSeverity = level === 'alert' ? 'CRITICAL' : 'WARNING';
  return {
    category: high ? input.highCategory : input.lowCategory,
    severity,
    currentValue: input.value,
    thresholdValue: bandThresholdValue(input.value, input.band, level, high),
    unit: input.unit,
    action: severity === 'CRITICAL' ? input.criticalAction : 'DASHBOARD_ONLY',
    message: high
      ? (severity === 'CRITICAL' ? `${input.highLabel} critically high` : `${input.highLabel} above normal range`)
      : (severity === 'CRITICAL' ? `${input.lowLabel} critically low` : `${input.lowLabel} below normal range`),
  };
};

export const severityRank = (severity: AlertSeverity | string): number => {
  switch (String(severity).toUpperCase()) {
    case 'EMERGENCY': return 3;
    case 'CRITICAL': return 2;
    case 'WARNING': return 1;
    default: return 0;
  }
};

export const ruleEngine = (input: RuleEngineInput): RuleAlertResult[] => {
  const alerts: RuleAlertResult[] = [];

  const health = input.sensorHealth ? refreshHealth(input.sensorHealth) : null;
  /**
   * Each sensor is judged on its own reading. Missing/uncalibrated peers must not
   * block SMS for a sensor that already has a finite, in-range value.
   * SENSOR_ERROR / INVALID still skip that one channel (e.g. DS18B20 -127).
   */
  const usable = (name: 'temperature' | 'ph' | 'turbidity' | 'orp', value: unknown): value is number => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return false;
    if (name === 'temperature' && (value === -127 || value < -55 || value > 125)) return false;
    if (name === 'ph' && (value < 0 || value > 14)) return false;
    if (name === 'turbidity' && value < 0) return false;
    if (name === 'orp' && (value < -500 || value > 1500)) return false;
    if (health) {
      const state = health[name === 'orp' ? 'orp' : name];
      if (state?.health === 'SENSOR_ERROR' || state?.health === 'INVALID') return false;
    }
    return true;
  };
  const bands = input.thresholdBands ?? DEFAULT_THRESHOLD_BANDS;

  // Temperature, pH, turbidity, and ORP share Overview Thresholds cuts.
  if (usable('temperature', input.temperature)) {
    if (input.temperature < 10) {
      alerts.push({
        category: 'TEMP_LOW',
        severity: 'EMERGENCY',
        currentValue: input.temperature,
        thresholdValue: 10,
        unit: 'C',
        action: 'WATER_CHANGE',
        message: 'Temperature dangerously low',
      });
    } else if (input.temperature > 35) {
      alerts.push({
        category: 'TEMP_HIGH',
        severity: 'EMERGENCY',
        currentValue: input.temperature,
        thresholdValue: 35,
        unit: 'C',
        action: 'WATER_CHANGE',
        message: 'Temperature dangerously high',
      });
    } else {
      const alert = bandAlert({
        value: input.temperature,
        band: bands.temperature,
        unit: 'C',
        lowCategory: 'TEMP_LOW',
        highCategory: 'TEMP_HIGH',
        criticalAction: 'WATER_CHANGE',
        lowLabel: 'Temperature',
        highLabel: 'Temperature',
      });
      if (alert) alerts.push(alert);
    }
  }

  if (usable('ph', input.ph)) {
    const alert = bandAlert({
      value: input.ph,
      band: bands.ph,
      unit: 'pH',
      lowCategory: 'PH_LOW',
      highCategory: 'PH_HIGH',
      criticalAction: 'WATER_REPLACEMENT',
      lowLabel: 'pH',
      highLabel: 'pH',
    });
    if (alert) alerts.push(alert);
  }

  if (input.dissolvedOxygen !== null && Number.isFinite(input.dissolvedOxygen) && input.dissolvedOxygen >= 0 && input.dissolvedOxygen <= 20) {
    if (input.dissolvedOxygenMeasured !== false && input.dissolvedOxygen < 2) {
      alerts.push({
        category: 'DO_LOW',
        severity: 'EMERGENCY',
        currentValue: input.dissolvedOxygen,
        thresholdValue: 2,
        unit: 'mg/L',
        action: 'AERATOR_ON_IMMEDIATE',
        message: 'Dissolved oxygen dangerously low',
      });
    } else if (input.dissolvedOxygenMeasured !== false && input.dissolvedOxygen < 3) {
      alerts.push({
        category: 'DO_LOW',
        severity: 'CRITICAL',
        currentValue: input.dissolvedOxygen,
        thresholdValue: 3,
        unit: 'mg/L',
        action: 'AERATOR_ON_IMMEDIATE',
        message: 'Dissolved oxygen critically low',
      });
    } else if (input.dissolvedOxygenMeasured !== false && input.dissolvedOxygen < 5) {
      alerts.push({
        category: 'DO_LOW',
        severity: 'WARNING',
        currentValue: input.dissolvedOxygen,
        thresholdValue: 5,
        unit: 'mg/L',
        action: 'AERATOR_ON',
        message: 'Dissolved oxygen below ideal range',
      });
    }
  }

  if (input.turbidityUnit === 'NTU' && usable('turbidity', input.turbidity)) {
    const alert = bandAlert({
      value: input.turbidity,
      band: bands.turbidity,
      unit: 'NTU',
      lowCategory: 'TURBIDITY_HIGH',
      highCategory: 'TURBIDITY_HIGH',
      criticalAction: 'WATER_REPLACEMENT',
      lowLabel: 'Turbidity',
      highLabel: 'Turbidity',
    });
    if (alert) alerts.push(alert);
  }

  if (usable('orp', input.orp)) {
    const alert = bandAlert({
      value: input.orp,
      band: bands.orp,
      unit: 'mV',
      lowCategory: 'ORP_LOW',
      highCategory: 'ORP_HIGH',
      criticalAction: 'WATER_CHANGE',
      lowLabel: 'ORP',
      highLabel: 'ORP',
    });
    if (alert) alerts.push(alert);
  }

  // No ammonia toxicity thresholds until a policy with explicit NH3-N units is commissioned.
  // Speciation percentage alone must never create a toxicity alert.
  return alerts;
};
