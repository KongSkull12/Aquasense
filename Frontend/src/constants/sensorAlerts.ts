/** Mirrors Backend SENSOR_ALERT_CATALOG — every rule that auto-texts WARNING+. */
export interface SensorAlertCatalogEntry {
  category: string;
  sensor: string;
  unit: string;
  autoSms: boolean;
  triggers: Array<{ severity: string; when: string; limit: string }>;
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
