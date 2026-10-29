export type SensorName = 'temperature'|'ph'|'turbidity'|'orp';
export type HealthState = 'VALID' | 'INVALID' | 'SENSOR_ERROR' | 'MISSING' | 'STALE' | 'UNSTABLE' | 'SATURATED' | 'POSSIBLY_STUCK';
export interface SensorHealth {
  name: SensorName; value: number | null; rawAdc: number | null; voltage: number | null;
  adcMinimum:number|null; adcMaximum:number|null; adcLast:number|null; clippedSamples:number|null;
  unit: string; timestamp: string | null; health: HealthState; valid: boolean;
  rawAvailable?: boolean; measurementValid?: boolean;
  stability: 'COLLECTING' | 'STABLE' | 'UNSTABLE'; calibration: 'REQUIRED' | 'CALIBRATED';
  reason: string; readyForCalibration: boolean; communication: boolean;
  adcRange: 'PASS' | 'WARNING' | 'UNKNOWN'; stuckDurationMs: number;
  window: { count: number; min: number | null; max: number | null; average: number | null; range: number | null; standardDeviation: number | null };
}
export interface UltrasonicReading {
  connected: boolean;
  valid: boolean;
  distanceCm: number|null;
  levelPercent: number|null;
  timestamp: string|null;
  reason: string;
}
export type HealthSummary = Record<SensorName, SensorHealth> & { ultrasonic?: UltrasonicReading };

export interface TanMeasurement { value:number; unit:'mg/L as N'; source:'test_kit'|'laboratory'|'external_sensor'|'manual'; validated:true; timestamp:string|number; validationEvidence?:string; validationStatus?:'USER_ATTESTED'; enteredAt?:string|number; }
export interface Speciation {status:string; percent:number|null; fraction:number|null; pKa:number|null; nh3N:number|null; tan:TanMeasurement|null; reason:string; waterType:string; }
