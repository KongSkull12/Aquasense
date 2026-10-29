import { Op } from 'sequelize';
import { Alert } from '../database/models/Alert';
import { PredictionLog as PredictionLogModel } from '../database/models/PredictionLog';

export interface PredictionLogRecord {
  id: string;
  riskScore: number;
  riskLevel: string;
  predictedIssue: string;
  etaMinutes: number | null;
  triggeredAlertId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

class PredictionLogService {
  async createLog(input: {
    riskScore: number;
    riskLevel: string;
    predictedIssue: string;
    etaMinutes: number | null;
    triggeredAlertId?: string | null;
  }): Promise<PredictionLogRecord> {
    const record = await PredictionLogModel.create(input);
    return this.mapRecord(record);
  }

  async getRecentLogs(limit: number = 60, deviceIds?: string[]): Promise<PredictionLogRecord[]> {
    let scopedAlertIds: string[] | undefined;
    if (deviceIds) {
      if (deviceIds.length === 0) return [];
      const alerts = await Alert.findAll({
        attributes: ['id'],
        where: { deviceId: { [Op.in]: deviceIds } },
      });
      const alertIds = alerts.map((alert) => alert.id);
      if (alertIds.length === 0) return [];
      scopedAlertIds = alertIds;
    }
    const records = await PredictionLogModel.findAll({
      ...(scopedAlertIds ? { where: { triggeredAlertId: { [Op.in]: scopedAlertIds } } } : {}),
      order: [['createdAt', 'DESC']],
      limit,
    });
    return records.map((record) => this.mapRecord(record));
  }

  private mapRecord(record: PredictionLogModel): PredictionLogRecord {
    return {
      id: record.id,
      riskScore: record.riskScore,
      riskLevel: record.riskLevel,
      predictedIssue: record.predictedIssue,
      etaMinutes: record.etaMinutes,
      triggeredAlertId: record.triggeredAlertId,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }
}

export const predictionLogService = new PredictionLogService();
