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

const providerName = (): string => (config.sms.provider === 'semaphore' ? 'Semaphore' : 'UniSMS');

const SEMAPHORE_ENDPOINT = 'https://api.semaphore.co/api/v4/messages';

/** Semaphore takes Philippine numbers as 63XXXXXXXXXX (no plus sign). */
export const toSemaphoreNumber = (recipient: string): string | null => {
  const trimmed = recipient.trim();
  return /^\+63\d{10}$/.test(trimmed) ? trimmed.slice(1) : null;
};

/** Semaphore silently drops messages that start with the word TEST. */
export const startsWithTestWord = (message: string): boolean => /^test\b/i.test(message.trim());

/** Semaphore statuses: Queued and Pending are in transit, Sent reached the network. */
const SEMAPHORE_STATUS: Record<string, SmsStatus> = {
  queued: 'pending', pending: 'pending', sent: 'sent', failed: 'failed', refunded: 'failed',
};

/** Field errors such as { sendername: ['…'] } with no message_id mean nothing was sent. */
const semaphoreFieldErrors = (data: unknown): Record<string, unknown> | undefined => {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return undefined;
  const entries = Object.entries(data as Record<string, unknown>);
  if ('message_id' in (data as object) || !entries.length) return undefined;
  const isText = (value: unknown): boolean => typeof value === 'string'
    || (Array.isArray(value) && value.every((item) => typeof item === 'string'));
  return entries.every(([, value]) => isText(value)) ? Object.fromEntries(entries) : undefined;
};

export const parseSemaphoreResponse = (data: unknown, httpStatus: number, retries: number): SmsSendResult => {
  const fieldErrors = semaphoreFieldErrors(data);
  if (fieldErrors) {
    return smsResult('rejected', retries, { httpStatus, errors: fieldErrors, reason: 'Provider rejected the SMS; review validation errors' });
  }
  const first = (Array.isArray(data) ? data[0] : data) as { message_id?: unknown; status?: unknown } | undefined;
  const rawId = first?.message_id;
  const referenceId = typeof rawId === 'number' || (typeof rawId === 'string' && rawId.trim()) ? String(rawId) : undefined;
  const mapped = typeof first?.status === 'string' ? SEMAPHORE_STATUS[first.status.trim().toLowerCase()] : undefined;
  const status: SmsStatus = mapped && referenceId ? mapped : 'unknown';
  return smsResult(status, retries, { referenceId, httpStatus,
    reason: status === 'unknown' ? 'Unrecognized provider response; verify before resending'
      : status === 'failed' ? `Semaphore reported ${String(first?.status)}` : undefined });
};

const maskSensitive = (value: unknown): unknown => {
  let serialized = JSON.stringify(value) ?? 'null';
  for (const secret of [config.sms.apiSecretKey, config.jwt.secret]) {
    if (secret) serialized = serialized.split(secret).join('[redacted]');
  }
  return JSON.parse(serialized.replace(/\+?63\d{10}/g, '[phone redacted]')) as unknown;
};

/** Plain-language reason from a stored provider response, safe to show in the dashboard. */
export const describeSmsFailure = (results: SmsSendResult[]): string => {
  const details = results.map((result) => {
    try {
      const parsed = JSON.parse(result.response) as { errors?: Record<string, unknown>; reason?: string };
      const errors = parsed.errors && typeof parsed.errors === 'object'
        ? Object.entries(parsed.errors).flatMap(([key, value]) => {
          const text = Array.isArray(value)
            ? value.filter((item): item is string => typeof item === 'string').join(', ')
            : typeof value === 'string' ? value : '';
          return text ? [`${key}: ${text}`] : [];
        })
        : [];
      const name = providerName();
      if (config.sms.provider === 'semaphore' && errors.some((line) => /sendername/i.test(line))) {
        return 'Semaphore does not accept that sender name. Use one approved on your Semaphore account, or leave SEMAPHORE_SENDER_NAME empty to use the default.';
      }
      if (config.sms.provider === 'semaphore' && errors.some((line) => /apikey/i.test(line))) {
        return 'Semaphore rejected the API key. Check SEMAPHORE_API_KEY.';
      }
      if (errors.some((line) => /sender_id/i.test(line) && /does not exist/i.test(line))) {
        return 'UniSMS does not have that sender name. This account uses Unisoft.';
      }
      if (errors.length) return `${name} rejected the message (${errors.join('; ')}).`;
      return parsed.reason ? `${name}: ${parsed.reason}` : '';
    } catch {
      return '';
    }
  }).filter((detail) => detail.length > 0);
  return [...new Set(details)].join(' ');
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
    const semaphore = config.sms.provider === 'semaphore';
    const name = providerName();
    const senderId = config.sms.senderId?.trim();
    const apiKey = config.sms.apiSecretKey?.trim();
    if (!semaphore && !senderId) return smsResult('rejected', 0, { reason: 'UNISMS_SENDER_ID must be configured', httpStatus: 400 });
    if (!apiKey || /replace-with|changeme/i.test(apiKey)) {
      return smsResult('rejected', 0, { reason: `A valid ${semaphore ? 'SEMAPHORE_API_KEY' : 'UNISMS_API_SECRET_KEY'} is required`, httpStatus: 400 });
    }
    const semaphoreNumber = semaphore ? toSemaphoreNumber(recipient) : null;
    if (semaphore && !semaphoreNumber) {
      return smsResult('rejected', 0, { reason: 'Semaphore sends only to Philippine mobile numbers (+63XXXXXXXXXX)', httpStatus: 400 });
    }
    if (semaphore && startsWithTestWord(message)) {
      return smsResult('rejected', 0, { reason: 'Semaphore drops messages that start with the word TEST; reword the message', httpStatus: 400 });
    }
    if (Date.now() < this.circuitOpenUntil) return smsResult('unavailable', 0, { reason: 'SMS circuit breaker open' });

    const submit = () => (semaphore
      ? axios.post(SEMAPHORE_ENDPOINT, new URLSearchParams({
        apikey: apiKey, number: semaphoreNumber as string, message: message.trim(), ...(senderId ? { sendername: senderId } : {}),
      }).toString(), { timeout: 10000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
      : axios.post(this.endpoint, {
        recipient: recipient.trim(), content: message.trim(), sender_id: senderId,
      }, {
        auth: { username: apiKey, password: '' },
        timeout: 10000, headers: { 'Content-Type': 'application/json' },
      }));

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await submit();
        this.consecutiveFailures = 0;
        const result = semaphore
          ? parseSemaphoreResponse(response.data, response.status, attempt)
          : this.parseResponse(response.data, response.status, attempt);
        logger.info(`${name} submission result`, { status: result.status, referenceId: result.referenceId });
        return result;
      } catch (error) {
        const providerError = axios.isAxiosError(error) ? error : undefined;
        const httpStatus = providerError?.response?.status;
        const responseData = providerError?.response?.data;
        const errors = semaphore
          ? semaphoreFieldErrors(responseData) ?? (responseData as { errors?: unknown } | undefined)?.errors
          : (responseData as { errors?: unknown } | undefined)?.errors;
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
        logger.warn(`${name} submission not sent`, { status, httpStatus, code: providerError?.code });
        return smsResult(status, attempt, { httpStatus, errors,
          reason: rejected ? 'Provider rejected the SMS; review validation errors' : 'Submission not confirmed; verify provider history before resending' });
      }
    }
    return smsResult('unavailable');
  }

  /** Read-only status lookup; never resubmits the original SMS. */
  async getStatus(referenceId: string): Promise<SmsSendResult> {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(referenceId)) return smsResult('unknown', 0, { reason: 'Invalid reference ID' });
    if (config.sms.provider === 'semaphore') {
      try {
        const response = await axios.get(`${SEMAPHORE_ENDPOINT}/${encodeURIComponent(referenceId)}`, {
          params: { apikey: config.sms.apiSecretKey || '' }, timeout: 10000,
        });
        const result = parseSemaphoreResponse(response.data, response.status, 0);
        return result.referenceId === referenceId ? result : smsResult('unknown', 0, { referenceId, reason: 'Provider returned a different reference ID' });
      } catch {
        return smsResult('unknown', 0, { referenceId, reason: 'Status lookup unavailable; original submission must not be repeated' });
      }
    }
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
