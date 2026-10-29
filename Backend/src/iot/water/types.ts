/**
 * Water Quality Monitoring Types
 */

export interface WaterQualityReading {
  id: string;
  timestamp: Date;
  temperature: number | null; // Celsius (0-50)
  ph: number | null; // pH level (0-14)
  do: number | null; // Dissolved Oxygen (0-14 mg/L)
  doMeasured?: boolean;
  orp?: number | null; // ORP in mV; distinct from dissolved oxygen.
  turbidity: number | null; // Interpret using turbidityUnit; raw ADC is not NTU.
  ammonia: number | null; // NH3-N mg/L as N; null without validated TAN.
  location: string;
  status: 'normal' | 'warning' | 'critical' | 'unavailable';
  turbidityUnit?: string;
}

export interface WaterQualityThresholds {
  temperature: {
    min: number;
    max: number;
    warning: number;
  };
  ph: {
    min: number;
    max: number;
    optimal: {
      min: number;
      max: number;
    };
  };
  do: {
    min: number;
    critical: number;
    optimal: number;
  };
  turbidity: {
    max: number;
    warning: number;
  };
}

export interface WaterQualityStats {
  orp?: { current: number | null; average: number | null; min: number | null; max: number | null };
  timestamp: Date;
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
  healthScore: number | null; // 0-100
}

export interface HealthAlert {
  id: string;
  timestamp: Date;
  severity: 'info' | 'warning' | 'critical';
  parameter: 'temperature' | 'ph' | 'do' | 'turbidity';
  message: string;
  value: number;
  threshold: number;
}
