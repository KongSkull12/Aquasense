import type { AlertSeverity } from './ruleEngine.service';
import type { HealthSummary, UltrasonicReading } from './sensorHealth';

export interface SmsSensorLine {
  label: string;
  value: number | null;
  unit?: string;
  /** When false, the line shows Disconnected even if a stale value exists. */
  connected?: boolean;
}

export interface SmsTemplateInput {
  farmerName: string;
  farmName: string;
  tankName: string;
  severity: AlertSeverity;
  problem: string;
  value: number;
  unit: string;
  action: string;
  /** When the alert was raised (Asia/Manila in the SMS body). */
  alertAt?: Date | string | number;
  /** Full sensor snapshot for the SMS list. Missing/null → Disconnected. */
  sensors?: SmsSensorLine[];
}

const SMS_TIME_ZONE = 'Asia/Manila';

const prettyAction = (action: string): string => {
  switch (action) {
    case 'AERATOR_ON':
      return 'Please turn on the aerator.';
    case 'AERATOR_ON_IMMEDIATE':
      return 'Please turn on the aerator immediately.';
    case 'WATER_CHANGE':
      return 'Please check the tank and change the water.';
    case 'WATER_REPLACEMENT':
      return 'Please check the tank and replace the water soon.';
    default:
      return 'Please check the tank and dashboard.';
  }
};

// Generated SMS contains no links, including links accidentally entered as names.
const cleanText = (text: string): string => text
  .replace(/(?:https?:\/\/|www\.)\S+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,}(?:\/\S*)?/gi, '')
  .replace(/\b[A-Z]{3,}\b/g, (word) => word === 'NTU' ? word : word.toLowerCase())
  .replace(/\s+/g, ' ').trim().replace(/[.!?]+$/, '');

const sentence = (text: string): string => {
  const cleaned = cleanText(text);
  if (!cleaned) return '';
  const start = cleaned.startsWith('pH') ? cleaned : cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  return `${start}.`;
};

const problemSentence = (problem: string, value: number, unit: string): string => {
  const description = cleanText(problem)
    .replace(/^(Temperature|pH|Dissolved oxygen|Turbidity|Ammonia) (?!is\b)/i, '$1 is ')
    .replace(/\b(above|below) ideal range\b/gi, '$1 the ideal range');
  return sentence(`${description || 'Water reading needs review'} (${value} ${cleanText(unit)})`);
};

const formatReadingNumber = (value: number, unit?: string): string => {
  if (unit === 'pH') return (Math.round(value * 100) / 100).toFixed(2);
  if (unit === 'mV') return String(Math.round(value));
  if (unit === 'C' || unit === 'mg/L' || unit === 'cm' || unit === '%' || unit === 'NTU') {
    return Number.isInteger(value) ? String(value) : (Math.round(value * 10) / 10).toFixed(1);
  }
  return Number.isInteger(value) ? String(value) : String(Math.round(value * 100) / 100);
};

export const formatSmsAlertTimestamp = (alertAt?: Date | string | number): string => {
  const date = alertAt === undefined || alertAt === null || alertAt === ''
    ? new Date()
    : new Date(alertAt);
  const at = Number.isFinite(date.getTime()) ? date : new Date();
  return new Intl.DateTimeFormat('en-PH', {
    timeZone: SMS_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  }).format(at);
};

export const formatSmsSensorLine = (sensor: SmsSensorLine): string => {
  const connected = sensor.connected !== false
    && sensor.value !== null
    && sensor.value !== undefined
    && Number.isFinite(sensor.value);
  if (!connected) return `${sensor.label}: Disconnected`;
  const rawUnit = sensor.unit ? cleanText(sensor.unit) : '';
  // Avoid "pH: 7.20 pH" — the label already names the parameter.
  const unit = rawUnit && rawUnit.toLowerCase() !== sensor.label.toLowerCase() ? ` ${rawUnit}` : '';
  return `${sensor.label}: ${formatReadingNumber(sensor.value as number, sensor.unit)}${unit}`;
};

const sensorConnected = (
  health: HealthSummary | undefined,
  name: keyof HealthSummary,
  value: number | null | undefined,
): boolean => {
  if (value === null || value === undefined || !Number.isFinite(value)) return false;
  if (!health) return true;
  const state = health[name];
  if (!state) return true;
  if (!state.valid) return false;
  if (state.health === 'MISSING' || state.health === 'SENSOR_ERROR' || state.health === 'STALE') return false;
  if (state.communication === false) return false;
  return true;
};

/** Build the standard AquaSense sensor list for alert SMS bodies. */
export const buildSmsSensorLines = (input: {
  temperature?: number | null;
  ph?: number | null;
  dissolvedOxygen?: number | null;
  dissolvedOxygenMeasured?: boolean;
  turbidity?: number | null;
  turbidityUnit?: string;
  orp?: number | null;
  ammonia?: number | null;
  tankLevel?: UltrasonicReading | null;
  sensorHealth?: HealthSummary;
}): SmsSensorLine[] => {
  const health = input.sensorHealth;
  const turbUnit = input.turbidityUnit === 'NTU' ? 'NTU' : input.turbidityUnit === 'raw_adc' ? 'ADC' : undefined;
  const depth = input.tankLevel?.depthCm ?? null;
  const depthConnected = Boolean(
    input.tankLevel
    && input.tankLevel.connected
    && input.tankLevel.valid
    && depth !== null
    && Number.isFinite(depth),
  );

  return [
    {
      label: 'Temp',
      value: input.temperature ?? null,
      unit: 'C',
      connected: sensorConnected(health, 'temperature', input.temperature),
    },
    {
      label: 'pH',
      value: input.ph ?? null,
      unit: 'pH',
      connected: sensorConnected(health, 'ph', input.ph),
    },
    {
      label: 'DO',
      value: input.dissolvedOxygenMeasured === false ? null : (input.dissolvedOxygen ?? null),
      unit: 'mg/L',
      connected: input.dissolvedOxygenMeasured !== false
        && input.dissolvedOxygen !== null
        && input.dissolvedOxygen !== undefined
        && Number.isFinite(input.dissolvedOxygen),
    },
    {
      label: 'Turbidity',
      value: input.turbidity ?? null,
      unit: turbUnit,
      connected: sensorConnected(health, 'turbidity', input.turbidity),
    },
    {
      label: 'ORP',
      value: input.orp ?? null,
      unit: 'mV',
      connected: sensorConnected(health, 'orp', input.orp),
    },
    {
      label: 'Depth',
      value: depthConnected ? depth : null,
      unit: 'cm',
      connected: depthConnected,
    },
  ];
};

const fitMessage = (parts: string[], maxLength = 480): string => {
  const joined = parts.filter(Boolean).join('\n');
  if (joined.length <= maxLength) return joined;
  // Prefer keeping header, when, sensor list, and action; drop optional location lines last.
  let trimmed = joined;
  while (trimmed.length > maxLength && trimmed.includes('\n')) {
    const lines = trimmed.split('\n');
    if (lines.length <= 3) break;
    // Drop the farm/tank location line if still over budget (line index 1 after header).
    lines.splice(1, 1);
    trimmed = lines.join('\n');
  }
  return trimmed.length <= maxLength ? trimmed : trimmed.slice(0, maxLength - 1).trimEnd() + '…';
};

const composeListSms = (input: {
  header: string;
  farmName: string;
  tankName: string;
  problem?: string;
  alertAt?: Date | string | number;
  sensors?: SmsSensorLine[];
  fallbackDetail?: string;
  action: string;
}): string => {
  const location = [cleanText(input.farmName), cleanText(input.tankName)].filter(Boolean).join(', ');
  const when = `When: ${formatSmsAlertTimestamp(input.alertAt)}`;
  const sensorLines = (input.sensors && input.sensors.length)
    ? input.sensors.map(formatSmsSensorLine)
    : [];
  const details = sensorLines.length
    ? sensorLines
    : [input.fallbackDetail || ''].filter(Boolean);

  return fitMessage([
    input.header,
    location ? sentence(location).replace(/\.$/, '') : '',
    input.problem ? sentence(input.problem) : '',
    when,
    ...details,
    input.action,
  ]);
};

// Keep under a short single segment for manual "Send test SMS" so free-tier credits stay reliable.
export const DEFAULT_TEST_SMS = 'AquaSense notification test. No action is required.';

export const buildSmsTemplate = (input: SmsTemplateInput): string => {
  return composeListSms({
    header: `AquaSense ${input.severity.toLowerCase()} alert.`,
    farmName: input.farmName,
    tankName: input.tankName,
    problem: input.problem,
    alertAt: input.alertAt,
    sensors: input.sensors,
    fallbackDetail: problemSentence(input.problem, input.value, input.unit),
    action: prettyAction(input.action),
  });
};

export const buildCombinedAlertSmsTemplate = (input: {
  farmName: string;
  tankName: string;
  severity: AlertSeverity;
  problems: Array<{ message: string; value: number; unit: string }>;
  action: string;
  alertAt?: Date | string | number;
  sensors?: SmsSensorLine[];
}): string => {
  const problemText = input.problems.map((problem) => problemSentence(problem.message, problem.value, problem.unit)).join(' ');
  return composeListSms({
    header: `AquaSense ${input.severity.toLowerCase()} alert.`,
    farmName: input.farmName,
    tankName: input.tankName,
    problem: input.problems.map((p) => p.message).join('; '),
    alertAt: input.alertAt,
    sensors: input.sensors,
    fallbackDetail: problemText || 'Please review the water alerts in the dashboard.',
    action: prettyAction(input.action),
  });
};

export const buildPredictiveSmsTemplate = (input: {
  farmName: string;
  tankName: string;
  riskLevel: 'HIGH' | 'CRITICAL';
  cause: string;
  etaMinutes: number | null;
  alertAt?: Date | string | number;
  sensors?: SmsSensorLine[];
}): string => {
  const eta = input.etaMinutes !== null && Number.isFinite(input.etaMinutes) && input.etaMinutes >= 0
    ? `Water may become unsafe in about ${Math.ceil(input.etaMinutes)} ${Math.ceil(input.etaMinutes) === 1 ? 'minute' : 'minutes'}.`
    : 'The time to unsafe conditions is uncertain.';
  const causes = input.cause.replace(/\bDO\b/g, 'dissolved oxygen').split(/\s*\+\s*/).map(cleanText).filter(Boolean);
  return composeListSms({
    header: `AquaSense ${input.riskLevel.toLowerCase()} risk forecast.`,
    farmName: input.farmName,
    tankName: input.tankName,
    problem: `Risk factors: ${causes.join(', ')}`,
    alertAt: input.alertAt,
    sensors: input.sensors,
    fallbackDetail: sentence(`Risk factors: ${causes.join(', ')}`),
    action: `${eta} Please check the tank now.`,
  });
};
