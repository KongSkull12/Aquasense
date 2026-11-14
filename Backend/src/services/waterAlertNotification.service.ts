import { decisionEligible, type HealthSummary, type UltrasonicReading } from './sensorHealth';
import { alertService } from './alert.service';
import { predictiveAnalyticsService } from './predictiveAnalytics.service';
import { ruleEngine, type AlertSeverity, type RuleAlertResult } from './ruleEngine.service';
import { smsNotificationService } from './smsNotification.service';
import { buildPredictiveSmsTemplate, buildSmsSensorLines, buildSmsTemplate } from './smsTemplate.service';
import { alertPhonesForDevice } from './smsRecipients';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export interface WaterAlertNotificationInput {
  deviceId: string;
  temperature: number | null;
  ph: number | null;
  dissolvedOxygen: number | null;
  dissolvedOxygenMeasured?: boolean;
  turbidity: number | null;
  ammonia?: number | null;
  orp?: number | null;
  tankLevel?: UltrasonicReading | null;
  sensorHealth?: HealthSummary;
  turbidityUnit?: string;
  /** Reading / alert time used in the SMS timestamp line. */
  timestamp?: Date | string | number;
}

export interface WaterAlertNotificationResult {
  alertsCreated: number;
  smsSentCount: number;
}

/** Warning, critical and emergency water-quality alerts all send SMS (INFO does not). */
const shouldSendSmsForSeverity = (severity: AlertSeverity): boolean => {
  return severity === 'WARNING' || severity === 'CRITICAL' || severity === 'EMERGENCY';
};

class WaterAlertNotificationService {
  async processReading(input: WaterAlertNotificationInput): Promise<WaterAlertNotificationResult> {
    // Diagnostics are displayed with the reading; they are not commissioned incidents.
    if (!decisionEligible(input.sensorHealth)) return { alertsCreated: 0, smsSentCount: 0 };
    const alerts = ruleEngine(input);
    let alertsCreated = 0;
    let smsSentCount = 0;
    let triggeredAlertId: string | undefined;
    const smsCandidates: Array<{ alertId: string; alert: RuleAlertResult }> = [];

    for (const alert of alerts) {
      const upserted = await alertService.upsertActiveAlert({
        deviceId: input.deviceId,
        category: alert.category,
        severity: alert.severity,
        currentValue: alert.currentValue,
        thresholdValue: alert.thresholdValue,
        unit: alert.unit,
        action: alert.action,
        message: alert.message,
      });

      if (upserted.created) alertsCreated += 1;
      triggeredAlertId = upserted.alert.id;

      if (!shouldSendSmsForSeverity(alert.severity)) {
        continue;
      }

      // SMS on first open, severity escalate, or when a prior send never landed.
      const needsSms = upserted.created || upserted.escalated || !upserted.alert.smsSentAt;
      if (needsSms) {
        smsCandidates.push({ alertId: upserted.alert.id, alert });
      }
    }

    await alertService.resolveClearedCategories(
      input.deviceId,
      alerts.map((alert) => alert.category)
    );

    // One SMS per sensor category (TEMP_*, PH_*, DO_*, TURBIDITY_*) so a pH
    // warning still texts even if a temperature alert was sent recently.
    // Cooldown is tracked per category (15 min standard / 5 min emergency).
    for (const candidate of smsCandidates) {
      const sent = await this.sendSingleRuleAlertSms(input.deviceId, candidate, input);
      if (sent) smsSentCount += 1;
    }

    // This prediction model requires measured oxygen. Other measured-parameter
    // rule alerts above remain active when that sensor is unavailable.
    if (input.dissolvedOxygenMeasured === false) return { alertsCreated, smsSentCount };
    const predictive = await predictiveAnalyticsService.persistCurrentPrediction(60, triggeredAlertId);
    const predictiveRiskLevel = predictive.warningCard.riskLevel;
    if (smsCandidates.length === 0 && (predictiveRiskLevel === 'HIGH' || predictiveRiskLevel === 'CRITICAL')) {
      const sent = await this.sendPredictiveSms(input.deviceId, {
        riskLevel: predictiveRiskLevel,
        cause: predictive.warningCard.cause,
        estimatedUnsafeInMinutes: predictive.warningCard.estimatedUnsafeInMinutes,
      }, input);
      if (sent) {
        smsSentCount += 1;
      }
    }

    return {
      alertsCreated,
      smsSentCount,
    };
  }

  async processPredictiveWarning(
    deviceId: string,
    warningCard: {
      riskLevel: 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL' | 'UNAVAILABLE';
      cause: string;
      estimatedUnsafeInMinutes: number | null;
    }
  ): Promise<boolean> {
    if (warningCard.riskLevel !== 'HIGH' && warningCard.riskLevel !== 'CRITICAL') {
      return false;
    }

    return this.sendPredictiveSms(deviceId, {
      riskLevel: warningCard.riskLevel,
      cause: warningCard.cause,
      estimatedUnsafeInMinutes: warningCard.estimatedUnsafeInMinutes,
    });
  }

  private sensorLinesFor(input: WaterAlertNotificationInput) {
    return buildSmsSensorLines({
      temperature: input.temperature,
      ph: input.ph,
      dissolvedOxygen: input.dissolvedOxygen,
      dissolvedOxygenMeasured: input.dissolvedOxygenMeasured,
      turbidity: input.turbidity,
      turbidityUnit: input.turbidityUnit,
      orp: input.orp,
      ammonia: input.ammonia,
      tankLevel: input.tankLevel,
      sensorHealth: input.sensorHealth,
    });
  }

  private async sendSingleRuleAlertSms(
    deviceId: string,
    entry: { alertId: string; alert: RuleAlertResult },
    input: WaterAlertNotificationInput,
  ): Promise<boolean> {
    const recipients = await alertPhonesForDevice(deviceId);
    if (!recipients.length) {
      logger.warn('SMS skipped: no alert recipients are turned on for this device', { deviceId });
      return false;
    }

    const { alert, alertId } = entry;
    const tankName = config.farm.tankName || deviceId;
    const smsMessage = buildSmsTemplate({
      farmerName: config.farm.farmerName || 'Farmer',
      farmName: config.farm.farmName,
      tankName,
      severity: alert.severity,
      problem: alert.message,
      value: alert.currentValue,
      unit: alert.unit,
      action: alert.action,
      alertAt: input.timestamp ?? new Date(),
      sensors: this.sensorLinesFor(input),
    });

    // Category = sensor rule (e.g. PH_LOW) so each parameter has its own cooldown.
    const results = await smsNotificationService.sendEach({
      deviceId,
      category: alert.category,
      severity: alert.severity,
      recipients,
      message: smsMessage,
      alertIds: [alertId],
    });
    return results?.some((result) => result.accepted) ?? false;
  }

  private async sendPredictiveSms(
    deviceId: string,
    warningCard: {
      riskLevel: 'HIGH' | 'CRITICAL';
      cause: string;
      estimatedUnsafeInMinutes: number | null;
    },
    input?: WaterAlertNotificationInput,
  ): Promise<boolean> {
    const recipients = await alertPhonesForDevice(deviceId);
    if (!recipients.length) {
      logger.warn('Predictive SMS skipped: no alert recipients are turned on for this device', { deviceId });
      return false;
    }

    const category = 'PREDICTIVE_WARNING';
    const severity: AlertSeverity = warningCard.riskLevel === 'CRITICAL' ? 'EMERGENCY' : 'CRITICAL';
    const smsMessage = buildPredictiveSmsTemplate({
      farmName: config.farm.farmName,
      tankName: config.farm.tankName || deviceId,
      riskLevel: warningCard.riskLevel,
      cause: warningCard.cause,
      etaMinutes: warningCard.estimatedUnsafeInMinutes,
      alertAt: input?.timestamp ?? new Date(),
      sensors: input ? this.sensorLinesFor(input) : undefined,
    });

    const results = await smsNotificationService.sendEach({
      deviceId, category, severity, recipients, message: smsMessage,
    });
    return results?.some((result) => result.accepted) ?? false;
  }
}

export const waterAlertNotificationService = new WaterAlertNotificationService();
