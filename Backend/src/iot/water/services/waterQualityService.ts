import { SensorValidator, SENSOR_NAMES } from '../../../services/sensorHealth';
/**
 * Water Quality Monitoring Service
 * Handles data storage, analysis, and threshold checking
 */
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../utils/logger';
import type {
  WaterQualityReading,
  WaterQualityThresholds,
  WaterQualityStats,
  HealthAlert,
} from '../types';
import { WaterQualitySetting } from '../../../database/models/WaterQualitySetting';

/**
 * Default thresholds for water quality parameters
 */
const DEFAULT_THRESHOLDS: WaterQualityThresholds = {
  temperature: {
    min: 15,
    max: 35,
    warning: 30,
  },
  ph: {
    min: 6.5,
    max: 8.5,
    optimal: {
      min: 7.0,
      max: 8.0,
    },
  },
  do: {
    min: 5,
    critical: 3,
    optimal: 8,
  },
  turbidity: {
    max: 100,
    warning: 50,
  },
};

export class WaterQualityService {
  private readings: WaterQualityReading[] = [];
  private alerts: HealthAlert[] = [];
  private thresholds: WaterQualityThresholds = DEFAULT_THRESHOLDS;
  private readonly MAX_READINGS = 1000; // Keep last 1000 readings in memory
  private readonly MAX_ALERTS = 500;

  /**
   * Add a new reading from IoT device or API
   */
  addReading(data: Omit<WaterQualityReading, 'id' | 'status'>): WaterQualityReading {
    const validator = new SensorValidator();
    data = {...data, ammonia:null};
    for (const name of SENSOR_NAMES) {
      if (name === 'orp') continue;
      if (!validator.validate('memory',name,data[name],data.timestamp).valid) data[name]=null;
    }
    if (data.doMeasured !== true || data.do === null || !Number.isFinite(data.do) || data.do < 0 || data.do > 20) data.do=null;
    if(data.turbidityUnit !== 'NTU') data.turbidity=null;
    const reading: WaterQualityReading = {
      ...data,
      id: uuidv4(),
      status: this.evaluateStatus(data.temperature, data.ph, data.do, data.turbidity),
    };

    // Keep only last MAX_READINGS
    this.readings.push(reading);
    if (this.readings.length > this.MAX_READINGS) {
      this.readings.shift();
    }

    logger.debug('New water quality reading added', {
      id: reading.id,
      temperature: reading.temperature,
      ph: reading.ph,
      do: reading.do,
      turbidity: reading.turbidity,
    });

    // Check thresholds and create alerts if needed
    this.checkThresholds(reading);

    return reading;
  }

  /**
   * Get latest reading
   */
  getLatestReading(): WaterQualityReading | null {
    return this.readings.length > 0 ? this.readings[this.readings.length - 1] : null;
  }

  /**
   * Get readings within time range
   */
  getReadingsByTimeRange(minutes: number): WaterQualityReading[] {
    const cutoffTime = new Date(Date.now() - minutes * 60000);
    return this.readings.filter((r) => new Date(r.timestamp) > cutoffTime);
  }

  /**
   * Get all readings (paginated)
   */
  getAllReadings(limit: number = 100, offset: number = 0): WaterQualityReading[] {
    return this.readings.slice(Math.max(0, this.readings.length - offset - limit), this.readings.length - offset).reverse();
  }

  /**
   * Calculate statistics for readings
   */
  getStatistics(minutes: number = 60): WaterQualityStats {
    const timeRangeReadings = this.getReadingsByTimeRange(minutes);
    const latest = this.getLatestReading();

    if (timeRangeReadings.length === 0) {
      return {
        timestamp: new Date(),
        temperature: {
          current: null,
          average: null,
          min: null,
          max: null,
        },
        ph: {
          current: null,
          average: null,
          min: null,
          max: null,
        },
        do: {
          current: null,
          average: null,
          min: null,
          max: null,
        },
        turbidity: {
          current: null,
          average: null,
          min: null,
          max: null,
        },
        ammonia: {
          current: null,
          average: null,
          min: null,
          max: null,
        },
        healthScore: null,
      };
    }

    const calculateStats = (param: keyof Omit<WaterQualityReading, 'id' | 'timestamp' | 'location' | 'status'>) => {
      const values = timeRangeReadings.map((r) => r[param]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (!values.length) return {current:null,average:null,min:null,max:null};
      return {
        current: values[values.length - 1],
        average: values.reduce((a, b) => a + b, 0) / values.length,
        min: Math.min(...values),
        max: Math.max(...values),
      };
    };

    const stats: WaterQualityStats = {
      timestamp: new Date(),
      temperature: calculateStats('temperature'),
      ph: calculateStats('ph'),
      do: calculateStats('do'),
      turbidity: calculateStats('turbidity'),
      ammonia: calculateStats('ammonia'),
      healthScore: this.calculateHealthScore(latest || timeRangeReadings[0]),
    };

    return stats;
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit: number = 50): HealthAlert[] {
    return this.alerts.slice(-limit).reverse();
  }

  /**
   * Clear old alerts
   */
  clearOldAlerts(hoursOld: number = 24): number {
    const cutoffTime = new Date(Date.now() - hoursOld * 3600000);
    const beforeLength = this.alerts.length;
    this.alerts = this.alerts.filter((a) => new Date(a.timestamp) > cutoffTime);
    return beforeLength - this.alerts.length;
  }

  /**
   * Update thresholds
   */
  async loadThresholds(): Promise<void> {
    const [setting] = await WaterQualitySetting.findOrCreate({
      where: { id: 'global' },
      defaults: { thresholds: this.thresholds },
    });
    this.thresholds = setting.thresholds;
  }

  async setThresholds(thresholds: WaterQualityThresholds): Promise<void> {
    const persistedThresholds = JSON.parse(JSON.stringify(thresholds)) as WaterQualityThresholds;
    await WaterQualitySetting.upsert({ id: 'global', thresholds: persistedThresholds });
    this.thresholds = persistedThresholds;
    logger.info('Water quality thresholds updated', this.thresholds);
  }

  /**
   * Get current thresholds
   */
  getThresholds(): WaterQualityThresholds {
    return this.thresholds;
  }

  /**
   * Private methods
   */

  private checkThresholds(reading: WaterQualityReading): void {
    if (reading.temperature !== null) {
    // Temperature check
    if (reading.temperature < this.thresholds.temperature.min) {
      this.createAlert(reading, 'temperature', 'critical', `Temperature too low: ${reading.temperature}°C`, this.thresholds.temperature.min);
    } else if (reading.temperature > this.thresholds.temperature.warning) {
      this.createAlert(reading, 'temperature', 'warning', `Temperature elevated: ${reading.temperature}°C`, this.thresholds.temperature.max);
    }

    }
    if (reading.ph !== null) {
    // pH check
    if (reading.ph < this.thresholds.ph.min || reading.ph > this.thresholds.ph.max) {
      this.createAlert(reading, 'ph', 'critical', `pH out of range: ${reading.ph}`, this.thresholds.ph.max);
    } else if (reading.ph < this.thresholds.ph.optimal.min || reading.ph > this.thresholds.ph.optimal.max) {
      this.createAlert(reading, 'ph', 'warning', `pH not optimal: ${reading.ph}`, this.thresholds.ph.optimal.max);
    }

    }
    if (reading.do !== null) {
    // DO (Dissolved Oxygen) check
    if (reading.do < this.thresholds.do.critical) {
      this.createAlert(reading, 'do', 'critical', `Critical low oxygen: ${reading.do} mg/L`, this.thresholds.do.critical);
    } else if (reading.do < this.thresholds.do.min) {
      this.createAlert(reading, 'do', 'warning', `Low oxygen level: ${reading.do} mg/L`, this.thresholds.do.min);
    }

    }
    if (reading.turbidity !== null) {
    // Turbidity check
    if (reading.turbidity > this.thresholds.turbidity.max) {
      this.createAlert(reading, 'turbidity', 'critical', `High turbidity: ${reading.turbidity} NTU`, this.thresholds.turbidity.max);
    } else if (reading.turbidity > this.thresholds.turbidity.warning) {
      this.createAlert(reading, 'turbidity', 'warning', `Elevated turbidity: ${reading.turbidity} NTU`, this.thresholds.turbidity.warning);
    }
  }

  }

  private createAlert(reading: WaterQualityReading, parameter: HealthAlert['parameter'], severity: HealthAlert['severity'], message: string, threshold: number): void {
    const alert: HealthAlert = {
      id: uuidv4(),
      timestamp: new Date(),
      severity,
      parameter,
      message,
      value: reading[parameter]!,
      threshold,
    };

    this.alerts.push(alert);
    if (this.alerts.length > this.MAX_ALERTS) {
      this.alerts.shift();
    }

    logger.warn(`Water quality alert: ${message}`, {
      parameter,
      severity,
      value: reading[parameter],
    });
  }

  private evaluateStatus(temperature: number|null, ph: number|null, _do: number|null, turbidity: number|null): 'normal' | 'warning' | 'critical' | 'unavailable' {
    if (temperature===null || ph===null || _do===null || turbidity===null) return 'unavailable';
    const issues = [
      temperature < this.thresholds.temperature.min || temperature > this.thresholds.temperature.warning,
      ph < this.thresholds.ph.min || ph > this.thresholds.ph.max,
      _do < this.thresholds.do.critical,
      turbidity > this.thresholds.turbidity.warning,
    ];

    if (issues.some((issue) => issue)) {
      return 'critical';
    }

    const warnings = [
      temperature > this.thresholds.temperature.min && temperature <= this.thresholds.temperature.warning,
      ph >= this.thresholds.ph.optimal.min && ph <= this.thresholds.ph.optimal.max,
      _do >= this.thresholds.do.min && _do < this.thresholds.do.optimal,
      turbidity >= this.thresholds.turbidity.warning && turbidity <= this.thresholds.turbidity.max,
    ];

    return warnings.some((w) => w) ? 'warning' : 'normal';
  }

  private calculateHealthScore(reading: WaterQualityReading): number|null {
    if (reading.temperature===null || reading.ph===null || reading.do===null || reading.turbidity===null || Date.now()-new Date(reading.timestamp).getTime()>15000) return null;
    let score = 100;

    // Temperature score
    if (reading.temperature < this.thresholds.temperature.min || reading.temperature > this.thresholds.temperature.max) {
      score -= 20;
    } else if (reading.temperature > this.thresholds.temperature.warning) {
      score -= 10;
    }

    // pH score
    if (reading.ph < this.thresholds.ph.min || reading.ph > this.thresholds.ph.max) {
      score -= 25;
    } else if (reading.ph < this.thresholds.ph.optimal.min || reading.ph > this.thresholds.ph.optimal.max) {
      score -= 10;
    }

    // DO score
    if (reading.do < this.thresholds.do.critical) {
      score -= 30;
    } else if (reading.do < this.thresholds.do.min) {
      score -= 15;
    } else if (reading.do < this.thresholds.do.optimal) {
      score -= 5;
    }

    // Turbidity score
    if (reading.turbidity > this.thresholds.turbidity.max) {
      score -= 20;
    } else if (reading.turbidity > this.thresholds.turbidity.warning) {
      score -= 10;
    }

    return Math.max(0, score);
  }
}

// Singleton instance
export const waterQualityService = new WaterQualityService();

// Service is ready to receive real sensor data via:
// 1. HTTP POST /api/v1/water/readings (from ESP32 or other IoT devices)
// 2. WebSocket events from connected clients
// 3. MQTT broker integration (future)
logger.info('✓ WaterQualityService ready for real sensor data from ESP32/IoT devices');
