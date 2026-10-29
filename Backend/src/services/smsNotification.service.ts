import { QueryTypes } from 'sequelize';
import { getDatabase } from '../database/connection';
import { config } from '../config/config';
import { cooldownService } from './cooldown.service';
import { smsLogService } from './smsLogService';
import { smsResult, smsService, type SmsSendResult } from './sms.service';
import type { AlertSeverity } from './ruleEngine.service';

export interface NotificationSms {
  deviceId: string;
  category: string;
  severity: AlertSeverity;
  recipient: string;
  message: string;
  alertIds?: string[];
}

class SmsNotificationService {
  private inFlight = new Set<string>();

  async send(input: NotificationSms): Promise<SmsSendResult | null> {
    const key = JSON.stringify([input.deviceId, input.category]);
    if (this.inFlight.has(key)) return null;
    this.inFlight.add(key);
    try {
      const alertIds = input.alertIds || [];
      const log = await getDatabase().transaction(async (transaction) => {
        // Transaction-scoped advisory lock also protects against multiple Node processes.
        const [lock] = await getDatabase().query<{ acquired: boolean }>(
          'SELECT pg_try_advisory_xact_lock(hashtext(:key)) AS acquired',
          { replacements: { key }, type: QueryTypes.SELECT, transaction }
        );
        if (!lock.acquired || !await cooldownService.shouldSendSms(input.deviceId, input.category, input.severity, transaction)) return null;
        // Commit BEFORE submitting. A crash or failed outcome write
        // leaves an uncertain reservation, preventing an accidental duplicate.
        const reservation = smsResult('unknown', 0, { reason: 'Submission reserved; outcome not yet confirmed' });
        return smsLogService.createLog({
          alertId: alertIds[0] || null, deviceId: input.deviceId, category: input.category,
          severity: input.severity, recipient: input.recipient, provider: config.sms.provider,
          providerResponse: JSON.stringify({ ...JSON.parse(reservation.response), alertIds }),
          success: false, retryCount: 0, sentAt: new Date(),
        }, transaction);
      });
      if (!log) return null;
      const result = await smsService.sendSms(input.recipient, input.message);
      await smsLogService.updateOutcome(log.id, result, alertIds);
      return result;
    } finally {
      this.inFlight.delete(key);
    }
  }
}

export const smsNotificationService = new SmsNotificationService();
