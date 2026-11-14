import { SensorValidator, refreshHealth, decisionEligible, type HealthSummary } from './sensorHealth';
export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY';
export type AlertCategory = 'TEMP_HIGH' | 'TEMP_LOW' | 'PH_LOW' | 'PH_HIGH' | 'DO_LOW' | 'TURBIDITY_HIGH' | 'AMMONIA_HIGH';
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
  sensorHealth?: HealthSummary;
  turbidityUnit?: string;
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

  const check = new SensorValidator();
  const health = input.sensorHealth ? refreshHealth(input.sensorHealth) : null;
  const usable = (name: 'temperature'|'ph'|'turbidity', value: unknown) => health ? health[name].valid : check.validate('rule',name,value,new Date()).valid;
  // Temperature (aligned with DEFAULT_THRESHOLD_BANDS: normal 26–29 °C)
  if (input.temperature !== null && usable('temperature', input.temperature)) {
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
  if (input.ph !== null && usable('ph', input.ph)) {
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
  if (input.turbidity !== null && input.turbidityUnit === 'NTU' && usable('turbidity', input.turbidity)) {
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
  // No ammonia toxicity thresholds until a policy with explicit NH3-N units is commissioned.
  // Speciation percentage alone must never create a toxicity alert.
  return alerts.map(alert => decisionEligible(input.sensorHealth) ? alert : ({...alert, action: 'DASHBOARD_ONLY', message: alert.message + ' (preliminary; calibration required)'}));
};
