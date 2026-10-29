import type { HealthSummary, Speciation, UltrasonicReading } from './sensorHealth';
/**
 * Water Quality Types
 * Frontend type definitions for water quality monitoring
 */

export interface WaterQualityReading {
  id: string;
  timestamp: Date;
  createdAt?: Date;
  temperature: number | null;
  ph: number | null;
  do: number | null;
  doMeasured?: boolean;
  waterQuality?: Record<string,string>;
  sensorHealth?: HealthSummary;
  tankLevel?: UltrasonicReading | null;
  speciation?: Speciation;
  orp?: number|null;
  turbidityUnit?: string;
  turbidity: number | null;
  ammonia: number | null;
  location: string;
  status: 'normal' | 'warning' | 'critical';
  connectionState?: 'LIVE' | 'ERROR';
}

export type TanSource = 'test_kit' | 'laboratory' | 'external_sensor' | 'manual';

export interface TanMeasurementRecord {
  id: string;
  deviceId: string;
  enteredByUserId: string;
  value: number;
  unit: 'mg/L as N';
  source: TanSource;
  sampleCollectedAt: string | Date;
  enteredAt: string | Date;
  validationEvidence: string;
  validationStatus: 'USER_ATTESTED';
  speciationStatus: 'AVAILABLE' | 'UNAVAILABLE';
  speciationReason: string;
  nh3Fraction: number | null;
  nh3N: number | null;
  environmentalReadingId: string | null;
}

export interface TanMeasurementEntry {
  deviceId: string;
  value: number;
  source: TanSource;
  sampleCollectedAt: string;
  validationEvidence: string;
  attestMeasurement: true;
}

export interface WaterQualityStats {
  timestamp: Date;
  stale?: boolean;
  temperature: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  ph: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  orp: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  do: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  turbidity: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  ammonia: {
    current: number | null;
    average: number | null;
    min: number | null;
    max: number | null;
  };
  healthScore: number | null;
}

export type AlertSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'EMERGENCY' | 'info' | 'warning' | 'critical';
export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface HealthAlert {
  id: string;
  deviceId?: string;
  category?: string;
  severity: AlertSeverity;
  currentValue?: number;
  thresholdValue?: number;
  unit?: string;
  action?: string;
  message: string;
  status?: AlertStatus;
  smsSentAt?: string | Date | null;
  createdAt?: string | Date;
  updatedAt?: string | Date;
  timestamp?: string | Date;
  parameter?: 'temperature' | 'ph' | 'do' | 'turbidity' | 'ammonia';
  value?: number;
  threshold?: number;
}

export interface PredictiveWarningCard {
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
  predictedIssue: string;
  cause: string;
  action: string;
  confidence: number;
  estimatedUnsafeInMinutes: number | null;
}

export interface PredictiveAnalyticsResult {
  generatedAt: string;
  modelVersion: string;
  horizonMinutes: number;
  modelStatus: 'READY' | 'DEGRADED' | 'UNAVAILABLE';
  validationStatus: 'VALIDATED' | 'NOT_COMMISSIONED';
  analysisStatus?: 'AVAILABLE' | 'INSUFFICIENT_VALID_SENSOR_DATA';
  riskScore: number|null;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
  predictedIssue: string;
  warningCard: PredictiveWarningCard;
  latest: {
    temperature: number | null;
    ph: number | null;
    turbidity: number | null;
    dissolvedOxygen: number;
    ammonia: number | null;
  } | null;
  movingAverage: {
    temperature: number | null;
    ph: number | null;
    turbidity: number | null;
    dissolvedOxygen: number;
    ammonia: number | null;
  } | null;
  dataQuality: {
    score: number;
    sampleCount: number;
    windowMinutes: number;
    newestSampleAgeMinutes: number | null;
    measuredAmmoniaRatio: number;
    notes: string[];
  };
  trends: {
    temperature: {
      slope: number;
      direction: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
    ph: {
      slope: number;
      direction: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
    turbidity: {
      slope: number;
      direction: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
    dissolvedOxygen: {
      slope: number;
      direction: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
    ammonia: {
      slope: number;
      direction: 'INCREASING' | 'DECREASING' | 'STABLE';
    };
  } | null;
}

export interface PredictionLog {
  id: string;
  riskScore: number;
  riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
  predictedIssue: string;
  etaMinutes: number | null;
  createdAt: string;
}

export type { SmsDeliveryStatus, SmsLogEntry } from './sms';
