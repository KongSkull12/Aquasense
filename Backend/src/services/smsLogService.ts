import { Op, type Transaction } from 'sequelize';
import { SmsLog as SmsLogModel } from '../database/models/SmsLog';
import { Alert } from '../database/models/Alert';
import { smsService, type SmsSendResult, type SmsStatus } from './sms.service';

export interface SmsLogEntry {
  id: string;
  alertId: string | null;
  deviceId: string;
  category: string;
  severity: string;
  recipient: string;
  provider: string;
  providerResponse: string;
  success: boolean;
  retryCount: number;
  sentAt: Date;
  createdAt: Date;
  updatedAt: Date;
  deliveryStatus?: SmsStatus;
  referenceId?: string;
}

class SmsLogService {
  private reconciling = false;

  async createLog(entry: Omit<SmsLogEntry, 'id' | 'createdAt' | 'updatedAt'>, transaction?: Transaction): Promise<SmsLogEntry> {
    const record = await SmsLogModel.create(entry, { transaction });
    return this.mapLog(record);
  }

  async getLatestLog(deviceId: string, category: string, transaction?: Transaction): Promise<SmsLogEntry | null> {
    const record = await SmsLogModel.findOne({
      where: {
        deviceId,
        category,
      },
      order: [['sentAt', 'DESC']],
      transaction,
    });

    return record ? this.mapLog(record) : null;
  }

  async updateOutcome(id: string, result: SmsSendResult, alertIds: string[] = []): Promise<void> {
    await SmsLogModel.update({
      success: result.success,
      retryCount: result.retryCount,
      providerResponse: JSON.stringify({ ...JSON.parse(result.response), alertIds }),
    }, { where: { id } });
    if (result.success && alertIds.length) {
      await Alert.update({ smsSentAt: new Date() }, { where: { id: { [Op.in]: alertIds } } });
    }
  }

  async reconcilePending(): Promise<void> {
    if (this.reconciling) return;
    this.reconciling = true;
    try {
      const logs = await SmsLogModel.findAll({
        where: { success: false, [Op.or]: [
          { providerResponse: { [Op.like]: '%"deliveryStatus":"pending"%' } },
          { providerResponse: { [Op.like]: '%"deliveryStatus":"retrying"%' } },
        ] },
        order: [['updatedAt', 'ASC']], limit: 20,
      });
      for (const log of logs) {
        const details = JSON.parse(log.providerResponse) as { referenceId?: string; alertIds?: string[] };
        if (!details.referenceId) continue;
        const result = await smsService.getStatus(details.referenceId);
        if (result.status !== 'unknown') {
          await this.updateOutcome(log.id, { ...result, retryCount: log.retryCount }, details.alertIds || (log.alertId ? [log.alertId] : []));
        }
      }
    } finally {
      this.reconciling = false;
    }
  }

  async getLogsForAlert(alertId: string): Promise<SmsLogEntry[]> {
    const logs = await SmsLogModel.findAll({
      where: {
        alertId: {
          [Op.eq]: alertId,
        },
      },
      order: [['sentAt', 'DESC']],
    });

    return logs.map((log) => this.mapLog(log));
  }

  async getRecentLogs(limit: number = 30, deviceIds?: string[]): Promise<SmsLogEntry[]> {
    if (deviceIds && deviceIds.length === 0) return [];
    const logs = await SmsLogModel.findAll({
      ...(deviceIds ? { where: { deviceId: { [Op.in]: deviceIds } } } : {}),
      order: [['sentAt', 'DESC']],
      limit,
    });
    return logs.map((log) => this.mapLog(log));
  }

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 7) {
      return 'Hidden';
    }
    return `${phone.slice(0, 4)}***${phone.slice(-2)}`;
  }

  private sanitizeProviderResponse(response: string): string {
    try {
      const parsed = JSON.parse(response) as { message?: { recipient?: string } };
      if (parsed.message?.recipient) {
        parsed.message.recipient = this.maskPhone(parsed.message.recipient);
      }
      return JSON.stringify(parsed);
    } catch {
      return response;
    }
  }

  private mapLog(log: SmsLogModel): SmsLogEntry {
    let deliveryStatus: SmsStatus = log.success ? 'sent' : 'failed';
    let referenceId: string | undefined;
    try {
      const details = JSON.parse(log.providerResponse);
      deliveryStatus = details.deliveryStatus || details.message?.status || deliveryStatus;
      referenceId = details.referenceId || details.message?.reference_id;
    } catch { /* Legacy logs may contain plain text. */ }
    return {
      id: log.id,
      alertId: log.alertId,
      deviceId: log.deviceId,
      category: log.category,
      severity: log.severity,
      recipient: this.maskPhone(log.recipient),
      provider: log.provider,
      providerResponse: this.sanitizeProviderResponse(log.providerResponse),
      success: log.success,
      retryCount: log.retryCount,
      sentAt: log.sentAt,
      createdAt: log.createdAt,
      updatedAt: log.updatedAt,
      deliveryStatus,
      referenceId,
    };
  }
}

export const smsLogService = new SmsLogService();
