import { smsLogService } from './smsLogService';
import type { AlertSeverity } from './ruleEngine.service';
import type { Transaction } from 'sequelize';

const severityRank: Record<AlertSeverity, number> = {
  INFO: 0,
  WARNING: 1,
  CRITICAL: 2,
  EMERGENCY: 3,
};

class CooldownService {
  private readonly standardCooldownMinutes = 15;
  private readonly emergencyCooldownMinutes = 5;

  async shouldSendSms(deviceId: string, category: string, severity: AlertSeverity, transaction?: Transaction): Promise<boolean> {
    const latestLog = await smsLogService.getLatestLog(deviceId, category, transaction);
    if (!latestLog) {
      return true;
    }

    // Pending or uncertain submissions require reconciliation, never a blind retry.
    if (['pending', 'retrying', 'unknown'].includes(latestLog.deliveryStatus || '')) return false;
    if (!latestLog.success) return Date.now() - latestLog.sentAt.getTime() >= 60000;

    const cooldownMinutes = severity === 'EMERGENCY' ? this.emergencyCooldownMinutes : this.standardCooldownMinutes;
    const cutoff = Date.now() - cooldownMinutes * 60 * 1000;

    if (latestLog.sentAt.getTime() < cutoff) {
      return true;
    }

    const lastSeverity = latestLog.severity as AlertSeverity;
    return severityRank[severity] > severityRank[lastSeverity];
  }
}

export const cooldownService = new CooldownService();
