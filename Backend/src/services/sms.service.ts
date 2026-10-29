import axios from 'axios';
import { config } from '../config/config';
import { logger } from '../utils/logger';

export type SmsStatus = 'sent' | 'pending' | 'retrying' | 'failed' | 'rejected' | 'unknown' | 'unavailable';
export interface SmsSendResult {
  /** True only when the provider reports sent; not a handset delivery receipt. */
  success: boolean;
  accepted: boolean;
  status: SmsStatus;
  referenceId?: string;
  httpStatus?: number;
  response: string;
  retryCount: number;
}

export const E164_PHONE_REGEX = /^\+[1-9]\d{7,14}$/;
export const isValidSmsRecipient = (recipient: string): boolean => E164_PHONE_REGEX.test(recipient.trim());
export const validateSmsMessage = (message: string): { valid: boolean; reason?: string } => {
  if (!message.trim()) return { valid: false, reason: 'Message cannot be empty' };
  if (message.trim().length > config.sms.maxMessageLength) {
    return { valid: false, reason: `Message exceeds ${config.sms.maxMessageLength} characters` };
  }
  return { valid: true };
};

const maskSensitive = (value: unknown): unknown => {
  let serialized = JSON.stringify(value) ?? 'null';
  for (const secret of [config.sms.apiSecretKey, config.jwt.secret]) {
    if (secret) serialized = serialized.split(secret).join('[redacted]');
  }
  return JSON.parse(serialized.replace(/\+?63\d{10}/g, '[phone redacted]')) as unknown;
};

export const smsResult = (
  status: SmsStatus, retryCount = 0,
  details: { referenceId?: string; httpStatus?: number; reason?: string; errors?: unknown } = {}
): SmsSendResult => ({
  success: status === 'sent',
  accepted: ['sent', 'pending', 'retrying'].includes(status),
  status,
  referenceId: details.referenceId,
  httpStatus: details.httpStatus,
  response: JSON.stringify(maskSensitive({ deliveryStatus: status, ...details })),
  retryCount,
});

export class SmsService {
  private readonly endpoint = 'https://unismsapi.com/api/sms';
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  private parseResponse(data: unknown, httpStatus: number, retries: number): SmsSendResult {
    const payload = data as { message?: { status?: string; reference_id?: string; fail_reason?: string } } | null;
    const message = payload?.message;
    const validStatus = ['sent', 'pending', 'retrying', 'failed'].includes(message?.status || '');
    const referenceId = typeof message?.reference_id === 'string' ? message.reference_id : undefined;
    const status = validStatus && referenceId ? message!.status as SmsStatus : 'unknown';
    return smsResult(status, retries, { referenceId, httpStatus,
      reason: status === 'unknown' ? 'Unrecognized provider response; verify before resending' : message?.fail_reason });
  }

  async sendSms(recipient: string, message: string): Promise<SmsSendResult> {
    if (!isValidSmsRecipient(recipient)) return smsResult('rejected', 0, { reason: 'Invalid E.164 recipient', httpStatus: 400 });
    const validation = validateSmsMessage(message);
    if (!validation.valid) return smsResult('rejected', 0, { reason: validation.reason, httpStatus: 400 });
    const senderId = config.sms.senderId?.trim();
    if (!senderId) return smsResult('rejected', 0, { reason: 'UNISMS_SENDER_ID must be configured', httpStatus: 400 });
    if (!config.sms.apiSecretKey?.trim() || /replace-with|changeme/i.test(config.sms.apiSecretKey)) {
      return smsResult('rejected', 0, { reason: 'A valid UNISMS_API_SECRET_KEY is required', httpStatus: 400 });
    }
    if (Date.now() < this.circuitOpenUntil) return smsResult('unavailable', 0, { reason: 'SMS circuit breaker open' });

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await axios.post(this.endpoint, {
          recipient: recipient.trim(), content: message.trim(), sender_id: senderId,
        }, {
          auth: { username: config.sms.apiSecretKey, password: '' },
          timeout: 10000, headers: { 'Content-Type': 'application/json' },
        });
        this.consecutiveFailures = 0;
        const result = this.parseResponse(response.data, response.status, attempt);
        logger.info('UniSMS submission result', { status: result.status, referenceId: result.referenceId });
        return result;
      } catch (error) {
        const providerError = axios.isAxiosError(error) ? error : undefined;
        const httpStatus = providerError?.response?.status;
        const errors = (providerError?.response?.data as { errors?: unknown } | undefined)?.errors;
        // Only retry failures known to precede submission. A timeout/reset/5xx
        // may follow acceptance and must not cause a duplicate SMS.
        const safeToRetry = !httpStatus && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(providerError?.code || '');
        if (safeToRetry && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
          continue;
        }
        const rejected = Boolean(httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408);
        const status = rejected ? 'rejected' : safeToRetry ? 'unavailable' : 'unknown';
        if (!rejected && ++this.consecutiveFailures >= config.sms.failureThreshold) {
          this.circuitOpenUntil = Date.now() + config.sms.circuitCooldownMs;
          this.consecutiveFailures = 0;
        }
        logger.warn('UniSMS submission not sent', { status, httpStatus, code: providerError?.code });
        return smsResult(status, attempt, { httpStatus, errors,
          reason: rejected ? 'Provider rejected the SMS; review validation errors' : 'Submission not confirmed; verify provider history before resending' });
      }
    }
    return smsResult('unavailable');
  }

  /** Read-only status lookup; never resubmits the original SMS. */
  async getStatus(referenceId: string): Promise<SmsSendResult> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(referenceId)) return smsResult('unknown', 0, { reason: 'Invalid reference ID' });
    try {
      const response = await axios.get(`${this.endpoint}/${encodeURIComponent(referenceId)}`, {
        auth: { username: config.sms.apiSecretKey || '', password: '' }, timeout: 10000,
      });
      const result = this.parseResponse(response.data, response.status, 0);
      return result.referenceId === referenceId ? result : smsResult('unknown', 0, { referenceId, reason: 'Provider returned a different reference ID' });
    } catch {
      return smsResult('unknown', 0, { referenceId, reason: 'Status lookup unavailable; original submission must not be repeated' });
    }
  }
}

export const smsService = new SmsService();
