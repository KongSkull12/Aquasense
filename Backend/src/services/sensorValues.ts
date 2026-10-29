export function parseOrp(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
export interface OrpStatistics {
  parameter: string;
  current: number | null;
  average: number | null;
  min: number | null;
  max: number | null;
}
export function orpStatistics(readings: Array<{ orp?: number | null }>): OrpStatistics {
  const values = readings.map(r => r.orp).filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return { parameter: 'ORP (mV)', current: parseOrp(readings[0]?.orp),
    average: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null,
    min: values.length ? Math.min(...values) : null, max: values.length ? Math.max(...values) : null };
}
