import { Op } from 'sequelize';
import { SensorReading as SensorReadingModel } from '../database/models/SensorReading';
import { TanMeasurement as TanMeasurementModel, type TanSource } from '../database/models/TanMeasurement';
import { ammoniaSpeciation, timestampMs, HEALTH_CONFIG, type TanMeasurement as TanSpeciationInput } from './sensorHealth';

export interface TanMeasurementInput {
  deviceId: string;
  value: number;
  source: TanSource;
  sampleCollectedAt: string;
  validationEvidence: string;
}

export interface TanMeasurementRecord {
  id: string;
  deviceId: string;
  enteredByUserId: string;
  value: number;
  unit: 'mg/L as N';
  source: TanSource;
  sampleCollectedAt: Date;
  enteredAt: Date;
  validationEvidence: string;
  validationStatus: 'USER_ATTESTED';
  speciationStatus: 'AVAILABLE' | 'UNAVAILABLE';
  speciationReason: string;
  nh3Fraction: number | null;
  nh3N: number | null;
  environmentalReadingId: string | null;
}

export class TanMeasurementInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TanMeasurementInputError';
  }
}

export class TanMeasurementService {
  async record(userId: string, input: TanMeasurementInput): Promise<TanMeasurementRecord> {
    const collectedAtMs = timestampMs(input.sampleCollectedAt);
    const enteredAt = new Date();
    if (!Number.isFinite(collectedAtMs) || collectedAtMs > enteredAt.getTime() + 2000) {
      throw new TanMeasurementInputError('Sample collection time must be a valid timestamp and cannot be in the future');
    }
    const model = await TanMeasurementModel.create({
      deviceId: input.deviceId,
      enteredByUserId: userId,
      value: input.value,
      unit: 'mg/L as N',
      source: input.source,
      sampleCollectedAt: new Date(collectedAtMs),
      enteredAt,
      validationEvidence: input.validationEvidence.trim(),
      validationStatus: 'USER_ATTESTED',
    });
    return this.mapRecord(model);
  }

  async list(deviceIds: string[] | null, limit: number): Promise<TanMeasurementRecord[]> {
    if (deviceIds && deviceIds.length === 0) return [];
    const rows = await TanMeasurementModel.findAll({
      where: deviceIds ? { deviceId: { [Op.in]: deviceIds } } : undefined,
      order: [['sampleCollectedAt', 'DESC'], ['enteredAt', 'DESC']],
      limit: Math.max(1, Math.min(100, limit)),
    });
    return Promise.all(rows.map((row) => this.mapRecord(row)));
  }

  private async mapRecord(row: TanMeasurementModel): Promise<TanMeasurementRecord> {
    const value = row.get({ plain: true }) as TanMeasurementModel;
    const sampleAt = new Date(value.sampleCollectedAt).getTime();
    const tan: TanSpeciationInput = {
      value: Number(value.value),
      unit: 'mg/L as N',
      source: value.source,
      validated: true,
      timestamp: new Date(sampleAt).toISOString(),
    };
    const candidateRows = await SensorReadingModel.findAll({
      where: {
        deviceId: value.deviceId,
        timestamp: { [Op.between]: [new Date(sampleAt - HEALTH_CONFIG.staleMs * 2), new Date(sampleAt + HEALTH_CONFIG.staleMs * 2)] },
      },
      order: [['timestamp', 'ASC']],
    });

    let speciationReason = 'No pH and temperature readings were found near this sample collection time';
    let nh3Fraction: number | null = null;
    let nh3N: number | null = null;
    let environmentalReadingId: string | null = null;
    for (const candidate of candidateRows) {
      const candidateData = candidate.get({ plain: true }) as SensorReadingModel;
      if (!candidateData.sensorHealth?.ph || !candidateData.sensorHealth?.temperature) continue;
      const phAt = timestampMs(candidateData.sensorHealth.ph.timestamp);
      const temperatureAt = timestampMs(candidateData.sensorHealth.temperature.timestamp);
      const aligned = Number.isFinite(phAt) && Number.isFinite(temperatureAt) &&
        Math.abs(sampleAt - phAt) <= HEALTH_CONFIG.staleMs &&
        Math.abs(sampleAt - temperatureAt) <= HEALTH_CONFIG.staleMs &&
        Math.abs(phAt - temperatureAt) <= HEALTH_CONFIG.staleMs;
      if (!aligned) continue;

      // Evaluate freshness at the sample time window, not the later data-entry time.
      // This permits a delayed test-kit result while retaining strict sample alignment.
      const evaluationTime = Math.max(sampleAt, phAt, temperatureAt);
      const speciation = ammoniaSpeciation(candidateData.sensorHealth, tan, 'freshwater', evaluationTime);
      nh3Fraction = speciation.fraction;
      nh3N = speciation.nh3N;
      speciationReason = speciation.nh3N === null
        ? `${speciation.reason}; ${speciation.concentrationReason}`
        : 'Calculated from user-reported measured TAN and aligned pH and temperature; sensor calibration remains a separate requirement';
      environmentalReadingId = candidateData.id;
      if (speciation.nh3N !== null) break;
    }

    return {
      id: value.id,
      deviceId: value.deviceId,
      enteredByUserId: value.enteredByUserId,
      value: Number(value.value),
      unit: 'mg/L as N',
      source: value.source,
      sampleCollectedAt: new Date(value.sampleCollectedAt),
      enteredAt: new Date(value.enteredAt),
      validationEvidence: value.validationEvidence,
      validationStatus: 'USER_ATTESTED',
      speciationStatus: nh3N === null ? 'UNAVAILABLE' : 'AVAILABLE',
      speciationReason,
      nh3Fraction,
      nh3N,
      environmentalReadingId,
    };
  }
}

export const tanMeasurementService = new TanMeasurementService();
