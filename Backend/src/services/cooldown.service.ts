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
  private readonly testRetryMs = 60 * 1000;
  private readonly testUncertainRetryMs = 5 * 60 * 1000;

  async shouldSendSms(deviceId: string, category: string, severity: AlertSeverity, transaction?: Transaction): Promise<boolean> {
    const latestLog = await smsLogService.getLatestLog(deviceId, category, transaction);
    if (!latestLog) {
      return true;
    }

    const uncertain = ['pending', 'retrying', 'unknown'].includes(latestLog.deliveryStatus || '');

    // A test is requested by a person, so an unconfirmed result expires instead of
    // blocking every later test. Nothing reconciles an 'unknown' reservation.
    if (category === 'SMS_TEST') {
      return Date.now() - latestLog.sentAt.getTime() >= (uncertain ? this.testUncertainRetryMs : this.testRetryMs);
    }

    // Pending or uncertain submissions require reconciliation, never a blind retry.
    if (uncertain) return false;
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
