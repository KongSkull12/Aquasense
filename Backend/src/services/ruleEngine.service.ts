import { refreshHealth, type HealthSummary } from './sensorHealth';
import { classifyBand, DEFAULT_THRESHOLD_BANDS, type ThresholdBands } from './thresholdBands';
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
  /** Saved dashboard Thresholds (ORP alert cuts). Defaults used when omitted. */
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
      { severity: 'WARNING', when: 'Below ideal range', limit: '< 26' },
      { severity: 'CRITICAL', when: 'Critically low', limit: '< 15' },
      { severity: 'EMERGENCY', when: 'Dangerously low', limit: '< 10' },
    ],
  },
  {
    category: 'TEMP_HIGH',
    sensor: 'Temperature',
    unit: 'C',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above ideal range', limit: '> 29' },
      { severity: 'CRITICAL', when: 'Critically high', limit: '> 32' },
      { severity: 'EMERGENCY', when: 'Dangerously high', limit: '> 35' },
    ],
  },
  {
    category: 'PH_LOW',
    sensor: 'pH',
    unit: 'pH',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Below ideal range', limit: '< 6.5' },
      { severity: 'CRITICAL', when: 'Critically low', limit: '< 6.0' },
    ],
  },
  {
    category: 'PH_HIGH',
    sensor: 'pH',
    unit: 'pH',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above ideal range', limit: '> 8.2' },
      { severity: 'CRITICAL', when: 'Critically high', limit: '> 8.5' },
    ],
  },
  {
    category: 'TURBIDITY_HIGH',
    sensor: 'Turbidity',
    unit: 'NTU',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above ideal range', limit: '> 70' },
      { severity: 'CRITICAL', when: 'Critically high', limit: '> 100' },
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
      { severity: 'WARNING', when: 'Below normal range', limit: 'Thresholds normal min' },
      { severity: 'CRITICAL', when: 'Below alert limit', limit: 'Thresholds alert min' },
    ],
  },
  {
    category: 'ORP_HIGH',
    sensor: 'ORP / redox',
    unit: 'mV',
    autoSms: true,
    triggers: [
      { severity: 'WARNING', when: 'Above normal range', limit: 'Thresholds normal max' },
      { severity: 'CRITICAL', when: 'Above alert limit', limit: 'Thresholds alert max' },
    ],
  },
];

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
  // Temperature (aligned with DEFAULT_THRESHOLD_BANDS: normal 26–29 °C)
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
  } else if (input.temperature < 15) {
    alerts.push({
      category: 'TEMP_LOW',
      severity: 'CRITICAL',
      currentValue: input.temperature,
      thresholdValue: 15,
      unit: 'C',
      action: 'WATER_CHANGE',
      message: 'Temperature critically low',
    });
  } else if (input.temperature < 26) {
    alerts.push({
      category: 'TEMP_LOW',
      severity: 'WARNING',
      currentValue: input.temperature,
      thresholdValue: 26,
      unit: 'C',
      action: 'DASHBOARD_ONLY',
      message: 'Temperature below ideal range',
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
  } else if (input.temperature > 32) {
    alerts.push({
      category: 'TEMP_HIGH',
      severity: 'CRITICAL',
      currentValue: input.temperature,
      thresholdValue: 32,
      unit: 'C',
      action: 'WATER_CHANGE',
      message: 'Temperature critically high',
    });
  } else if (input.temperature > 29) {
    alerts.push({
      category: 'TEMP_HIGH',
      severity: 'WARNING',
      currentValue: input.temperature,
      thresholdValue: 29,
      unit: 'C',
      action: 'DASHBOARD_ONLY',
      message: 'Temperature above ideal range',
    });
  }

  }
  if (usable('ph', input.ph)) {
  // pH Low
  if (input.ph < 6.0) {
    alerts.push({
      category: 'PH_LOW',
      severity: 'CRITICAL',
      currentValue: input.ph,
      thresholdValue: 6.0,
      unit: 'pH',
      action: 'WATER_REPLACEMENT',
      message: 'pH critically low',
    });
  } else if (input.ph < 6.5) {
    alerts.push({
      category: 'PH_LOW',
      severity: 'WARNING',
      currentValue: input.ph,
      thresholdValue: 6.5,
      unit: 'pH',
      action: 'DASHBOARD_ONLY',
      message: 'pH below ideal range',
    });
  }

  // pH High
  if (input.ph > 8.5) {
    alerts.push({
      category: 'PH_HIGH',
      severity: 'CRITICAL',
      currentValue: input.ph,
      thresholdValue: 8.5,
      unit: 'pH',
      action: 'WATER_REPLACEMENT',
      message: 'pH critically high',
    });
  } else if (input.ph > 8.2) {
    alerts.push({
      category: 'PH_HIGH',
      severity: 'WARNING',
      currentValue: input.ph,
      thresholdValue: 8.2,
      unit: 'pH',
      action: 'DASHBOARD_ONLY',
      message: 'pH above ideal range',
    });
  }

  }
  if (input.dissolvedOxygen !== null && Number.isFinite(input.dissolvedOxygen) && input.dissolvedOxygen >= 0 && input.dissolvedOxygen <= 20) {
  // Dissolved Oxygen
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
  // Turbidity
  if (input.turbidity > 100) {
    alerts.push({
      category: 'TURBIDITY_HIGH',
      severity: 'CRITICAL',
      currentValue: input.turbidity,
      thresholdValue: 100,
      unit: 'NTU',
      action: 'WATER_REPLACEMENT',
      message: 'Turbidity critically high',
    });
  } else if (input.turbidity > 70) {
    alerts.push({
      category: 'TURBIDITY_HIGH',
      severity: 'WARNING',
      currentValue: input.turbidity,
      thresholdValue: 70,
      unit: 'NTU',
      action: 'DASHBOARD_ONLY',
      message: 'Turbidity above ideal range',
    });
  }

  }

  // ORP uses saved Thresholds bands (same cuts as Overview Normal/Warning/Alert).
  const orpBand = input.thresholdBands?.orp ?? DEFAULT_THRESHOLD_BANDS.orp;
  if (usable('orp', input.orp)) {
    const level = classifyBand(input.orp, orpBand);
    if (level === 'alert' || level === 'warning') {
      const high = orpBand.alertMax != null && input.orp > (orpBand.normalMax ?? orpBand.alertMax);
      const severity: AlertSeverity = level === 'alert' ? 'CRITICAL' : 'WARNING';
      alerts.push({
        category: high ? 'ORP_HIGH' : 'ORP_LOW',
        severity,
        currentValue: input.orp,
        thresholdValue: high
          ? (level === 'alert' ? (orpBand.alertMax ?? orpBand.normalMax!) : orpBand.normalMax!)
          : (level === 'alert' ? (orpBand.alertMin ?? orpBand.normalMin!) : orpBand.normalMin!),
        unit: 'mV',
        action: severity === 'CRITICAL' ? 'WATER_CHANGE' : 'DASHBOARD_ONLY',
        message: high
          ? (severity === 'CRITICAL' ? 'ORP critically high' : 'ORP above normal range')
          : (severity === 'CRITICAL' ? 'ORP critically low' : 'ORP below normal range'),
      });
    }
  }

  // No ammonia toxicity thresholds until a policy with explicit NH3-N units is commissioned.
  // Speciation percentage alone must never create a toxicity alert.
  // Alerts and SMS are not demoted when other sensors are missing or uncalibrated.
  return alerts;
};
