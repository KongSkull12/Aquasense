import { Op } from 'sequelize';
import { Alert as AlertModel } from '../database/models/Alert';
import { severityRank } from './ruleEngine.service';

export type AlertStatus = 'ACTIVE' | 'ACKNOWLEDGED' | 'RESOLVED';

export interface AlertRecord {
  id: string;
  deviceId: string;
  category: string;
  severity: string;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  action: string;
  message: string;
  status: AlertStatus;
  smsSentAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAlertInput {
  deviceId: string;
  category: string;
  severity: string;
  currentValue: number;
  thresholdValue: number;
  unit: string;
  action: string;
  message: string;
}

export interface UpsertActiveAlertResult {
  alert: AlertRecord;
  created: boolean;
  escalated: boolean;
}

class AlertService {
  async createAlert(input: CreateAlertInput): Promise<AlertRecord> {
    const alert = await AlertModel.create({
      ...input,
      status: 'ACTIVE',
      smsSentAt: null,
    });

    return this.mapAlert(alert);
  }

  /**
   * One active row per device + sensor category. Re-readings update the same
   * alert instead of flooding the log; severity escalations are flagged for SMS.
   */
  async upsertActiveAlert(input: CreateAlertInput): Promise<UpsertActiveAlertResult> {
    const existing = await AlertModel.findOne({
      where: {
        deviceId: input.deviceId,
        category: input.category,
        status: { [Op.in]: ['ACTIVE', 'ACKNOWLEDGED'] },
      },
      order: [['createdAt', 'DESC']],
    });

    if (!existing) {
      const created = await this.createAlert(input);
      return { alert: created, created: true, escalated: false };
    }

    const escalated = severityRank(input.severity) > severityRank(existing.severity);
    existing.severity = input.severity;
    existing.currentValue = input.currentValue;
    existing.thresholdValue = input.thresholdValue;
    existing.unit = input.unit;
    existing.action = input.action;
    existing.message = input.message;
    existing.status = 'ACTIVE';
    if (escalated) {
      existing.smsSentAt = null;
    }
    await existing.save();
    return { alert: this.mapAlert(existing), created: false, escalated };
  }

  /** Clear open alerts for categories that are no longer out of range. */
  async resolveClearedCategories(deviceId: string, activeCategories: string[]): Promise<number> {
    const where: Record<string, unknown> = {
      deviceId,
      status: { [Op.in]: ['ACTIVE', 'ACKNOWLEDGED'] },
    };
    if (activeCategories.length) {
      where.category = { [Op.notIn]: activeCategories };
    }
    const [count] = await AlertModel.update(
      { status: 'RESOLVED' },
      { where }
    );
    return count;
  }

  async updateStatus(alertId: string, status: AlertStatus, deviceIds?: string[]): Promise<AlertRecord | null> {
    const alert = await AlertModel.findOne({ where: { id: alertId, ...(deviceIds ? { deviceId: { [Op.in]: deviceIds } } : {}) } });
    if (!alert) {
      return null;
    }

    if ((status === 'ACKNOWLEDGED' && alert.status !== 'ACTIVE') || (status === 'RESOLVED' && alert.status === 'RESOLVED')) {
      return null;
    }

    alert.status = status;
    await alert.save();
    return this.mapAlert(alert);
  }

  async markSmsSent(alertId: string, sentAt: Date): Promise<void> {
    await AlertModel.update({ smsSentAt: sentAt }, { where: { id: alertId } });
  }

  async getAlertById(alertId: string, deviceIds?: string[]): Promise<AlertRecord | null> {
    const alert = await AlertModel.findOne({ where: { id: alertId, ...(deviceIds ? { deviceId: { [Op.in]: deviceIds } } : {}) } });
    return alert ? this.mapAlert(alert) : null;
  }

  async getAlerts(limit: number = 50, status?: AlertStatus, deviceIds?: string[]): Promise<AlertRecord[]> {
    const where = { ...(status ? { status } : {}), ...(deviceIds ? { deviceId: { [Op.in]: deviceIds } } : {}) };
    const alerts = await AlertModel.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
    });

    return alerts.map((alert) => this.mapAlert(alert));
  }

  async getLatestAlert(deviceId: string, category: string): Promise<AlertRecord | null> {
    const alert = await AlertModel.findOne({
      where: {
        deviceId,
        category,
        createdAt: {
          [Op.ne]: null,
        },
      },
      order: [['createdAt', 'DESC']],
    });

    return alert ? this.mapAlert(alert) : null;
  }

  private mapAlert(alert: AlertModel): AlertRecord {
    return {
      id: alert.id,
      deviceId: alert.deviceId,
      category: alert.category,
      severity: alert.severity,
      currentValue: alert.currentValue,
      thresholdValue: alert.thresholdValue,
      unit: alert.unit,
      action: alert.action,
      message: alert.message,
      status: alert.status as AlertStatus,
      smsSentAt: alert.smsSentAt,
      createdAt: alert.createdAt,
      updatedAt: alert.updatedAt,
    };
  }
}

export const alertService = new AlertService();
