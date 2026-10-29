import type { AlertSeverity } from './ruleEngine.service';

export interface SmsTemplateInput {
  farmerName: string;
  farmName: string;
  tankName: string;
  severity: AlertSeverity;
  problem: string;
  value: number;
  unit: string;
  action: string;
}

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

// Keep whole sentences and the action. Prefer details over a long farm label.
// Full details remain available in dashboard alerts when they cannot fit here.
const composeSms = (header: string, farmName: string, tankName: string, details: string[], action: string): string => {
  const locations = [
    sentence([cleanText(farmName), cleanText(tankName)].filter(Boolean).join(', ')),
    sentence(tankName),
    '',
  ];
  for (const detail of details) {
    for (const location of locations) {
      const message = [header, location, detail, action].filter(Boolean).join(' ');
      if (message.length <= 160) return message;
    }
  }
  return `${header} ${action}`;
};

export const DEFAULT_TEST_SMS = 'AquaSense notification test. This message checks SMS delivery to your registered number. No action is required.';

export const buildSmsTemplate = (input: SmsTemplateInput): string => {
  return composeSms(
    `AquaSense ${input.severity.toLowerCase()} alert.`, input.farmName, input.tankName,
    [problemSentence(input.problem, input.value, input.unit), 'Please review the water readings in the dashboard.'],
    prettyAction(input.action),
  );
};

export const buildCombinedAlertSmsTemplate = (input: {
  farmName: string;
  tankName: string;
  severity: AlertSeverity;
  problems: Array<{ message: string; value: number; unit: string }>;
  action: string;
}): string => {
  const problems = input.problems.map((problem) => problemSentence(problem.message, problem.value, problem.unit));
  const details = [problems.join(' ')];
  if (problems.length > 1) details.push(`${problems[0]} Check other alerts in the dashboard.`);
  details.push('Please review the water alerts in the dashboard.');
  return composeSms(
    `AquaSense ${input.severity.toLowerCase()} alert.`, input.farmName, input.tankName,
    details, prettyAction(input.action),
  );
};

export const buildPredictiveSmsTemplate = (input: {
  farmName: string;
  tankName: string;
  riskLevel: 'HIGH' | 'CRITICAL';
  cause: string;
  etaMinutes: number | null;
}): string => {
  const eta = input.etaMinutes !== null && Number.isFinite(input.etaMinutes) && input.etaMinutes >= 0
    ? `Water may become unsafe in about ${Math.ceil(input.etaMinutes)} ${Math.ceil(input.etaMinutes) === 1 ? 'minute' : 'minutes'}.`
    : 'The time to unsafe conditions is uncertain.';
  const causes = input.cause.replace(/\bDO\b/g, 'dissolved oxygen').split(/\s*\+\s*/).map(cleanText).filter(Boolean);
  return composeSms(
    `AquaSense ${input.riskLevel.toLowerCase()} risk forecast.`, input.farmName, input.tankName,
    [sentence(`Risk factors: ${causes.join(', ')}`), 'Please review the forecast in the dashboard.', ''],
    `${eta} Please check the tank now.`,
  );
};
