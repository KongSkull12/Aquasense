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

const providerName = (): string => {
  if (config.sms.provider === 'semaphore') return 'Semaphore';
  if (config.sms.provider === 'iprogsms') return 'IPROG SMS';
  return 'UniSMS';
};

const SEMAPHORE_ENDPOINT = 'https://api.semaphore.co/api/v4/messages';
const UNISMS_ENDPOINT = 'https://unismsapi.com/api/sms';

/** Philippine mobiles as 63XXXXXXXXXX (no plus) for Semaphore and IPROG SMS. */
export const toPhMobileDigits = (recipient: string): string | null => {
  const trimmed = recipient.trim();
  return /^\+63\d{10}$/.test(trimmed) ? trimmed.slice(1) : null;
};

/** @deprecated Use toPhMobileDigits — kept for existing Semaphore tests. */
export const toSemaphoreNumber = toPhMobileDigits;

/** Semaphore silently drops messages that start with the word TEST. */
export const startsWithTestWord = (message: string): boolean => /^test\b/i.test(message.trim());

/** Semaphore statuses: Queued and Pending are in transit, Sent reached the network. */
const SEMAPHORE_STATUS: Record<string, SmsStatus> = {
  queued: 'pending', pending: 'pending', sent: 'sent', failed: 'failed', refunded: 'failed',
};

/** IPROG message_status / recent activity status values. */
const IPROG_STATUS: Record<string, SmsStatus> = {
  pending: 'pending',
  queued: 'pending',
  processing: 'pending',
  submitted: 'pending',
  completed: 'sent',
  sent: 'sent',
  success: 'sent',
  delivered: 'sent',
  failed: 'failed',
  error: 'failed',
  undelivered: 'failed',
  rejected: 'rejected',
};

/** IPROG returns `{ status: 500, message: ["…"] }` for sender/network rules. */
export const iprogMessageLines = (data: unknown): string[] => {
  if (!data || typeof data !== 'object') return [];
  const msg = (data as { message?: unknown }).message;
  if (Array.isArray(msg)) return msg.filter((line): line is string => typeof line === 'string' && line.trim().length > 0);
  if (typeof msg === 'string' && msg.trim()) return [msg.trim()];
  const err = (data as { error?: unknown }).error;
  if (typeof err === 'string' && err.trim()) return [err.trim()];
  return [];
};

export const isIprogRejectionPayload = (data: unknown): boolean => {
  if (!data || typeof data !== 'object') return false;
  const status = (data as { status?: unknown }).status;
  if (status === 500 || status === '500' || status === 'error') return true;
  return iprogMessageLines(data).some((line) => /sender name|smart\s*\/\s*tnt|insufficient|invalid|api[_ ]?token|unauthorized/i.test(line));
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

/** IPROG queues accepted SMS and returns message_id; treat HTTP/body success as pending. */
export const parseIprogSendResponse = (data: unknown, httpStatus: number, retries: number): SmsSendResult => {
  const payload = (data && typeof data === 'object' ? data : {}) as {
    status?: unknown;
    message?: unknown;
    message_id?: unknown;
    message_status?: unknown;
    error?: unknown;
    errors?: unknown;
  };
  const lines = iprogMessageLines(data);
  if (isIprogRejectionPayload(data) || (httpStatus >= 400 && lines.length > 0 && !payload.message_id)) {
    return smsResult('rejected', retries, {
      httpStatus,
      errors: { detail: lines.length ? lines : ['IPROG SMS rejected the request'] },
      reason: lines[0] || 'Provider rejected the SMS; review validation errors',
    });
  }
  const rawId = payload.message_id;
  const referenceId = typeof rawId === 'string' && rawId.trim() ? rawId.trim()
    : typeof rawId === 'number' ? String(rawId) : undefined;
  const bodyStatus = payload.status;
  const ok = bodyStatus === 200 || bodyStatus === '200' || bodyStatus === 'success'
    || (httpStatus >= 200 && httpStatus < 300 && Boolean(referenceId));
  if (referenceId && ok) {
    // Some responses already include message_status (e.g. completed).
    if (typeof payload.message_status === 'string') {
      const mapped = IPROG_STATUS[payload.message_status.trim().toLowerCase()];
      if (mapped === 'sent' || mapped === 'failed') {
        return smsResult(mapped, retries, { referenceId, httpStatus });
      }
    }
    return smsResult('pending', retries, { referenceId, httpStatus });
  }
  const errors = payload.errors
    ?? (lines.length ? { detail: lines } : undefined);
  return smsResult('unknown', retries, {
    referenceId, httpStatus, errors,
    reason: 'Unrecognized IPROG SMS response; verify before resending',
  });
};

export const parseIprogStatusResponse = (
  data: unknown, httpStatus: number, referenceId: string, retries = 0,
): SmsSendResult => {
  const payload = (data && typeof data === 'object' ? data : {}) as {
    message_status?: unknown;
    status?: unknown;
    message_id?: unknown;
  };
  const rawStatus = typeof payload.message_status === 'string' ? payload.message_status
    : typeof payload.status === 'string' && !/^(success|error|\d+)$/i.test(payload.status) ? payload.status
      : undefined;
  const mapped = rawStatus ? IPROG_STATUS[rawStatus.trim().toLowerCase()] : undefined;
  if (!mapped) {
    return smsResult('unknown', retries, { referenceId, httpStatus, reason: 'Unrecognized IPROG SMS status' });
  }
  return smsResult(mapped, retries, { referenceId, httpStatus,
    reason: mapped === 'failed' ? `IPROG SMS reported ${rawStatus}` : undefined });
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
      if (config.sms.provider === 'iprogsms' && errors.some((line) => /api[_ ]?token|unauthorized|unauthenticated|invalid token/i.test(line))) {
        return 'IPROG SMS rejected the API token. Check IPROG_SMS_API_TOKEN.';
      }
      if (config.sms.provider === 'iprogsms' && errors.some((line) => /smart\s*\/\s*tnt|sender name/i.test(line))) {
        return 'IPROG SMS cannot text Smart, TNT or Sun numbers with the shared sender name. Use a Globe or DITO number, or register your own sender name at iprogsms.com/sender-names/new.';
      }
      if (config.sms.provider === 'iprogsms' && errors.some((line) => /credit|balance|load/i.test(line))) {
        return 'IPROG SMS reports insufficient credits. Top up at iprogsms.com.';
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
  private consecutiveFailures = 0;
  private circuitOpenUntil = 0;

  private parseUnismsResponse(data: unknown, httpStatus: number, retries: number): SmsSendResult {
    const payload = data as { message?: { status?: string; reference_id?: string; fail_reason?: string } } | null;
    const message = payload?.message;
    const validStatus = ['sent', 'pending', 'retrying', 'failed'].includes(message?.status || '');
    const referenceId = typeof message?.reference_id === 'string' ? message.reference_id : undefined;
    const status = validStatus && referenceId ? message!.status as SmsStatus : 'unknown';
    return smsResult(status, retries, { referenceId, httpStatus,
      reason: status === 'unknown' ? 'Unrecognized provider response; verify before resending' : message?.fail_reason });
  }

  private credentialLabel(): string {
    if (config.sms.provider === 'semaphore') return 'SEMAPHORE_API_KEY';
    if (config.sms.provider === 'iprogsms') return 'IPROG_SMS_API_TOKEN';
    return 'UNISMS_API_SECRET_KEY';
  }

  async sendSms(recipient: string, message: string): Promise<SmsSendResult> {
    if (!isValidSmsRecipient(recipient)) return smsResult('rejected', 0, { reason: 'Invalid E.164 recipient', httpStatus: 400 });
    const validation = validateSmsMessage(message);
    if (!validation.valid) return smsResult('rejected', 0, { reason: validation.reason, httpStatus: 400 });

    const provider = config.sms.provider;
    const name = providerName();
    const senderId = config.sms.senderId?.trim();
    const apiKey = config.sms.apiSecretKey?.trim();

    if (provider === 'unisms' && !senderId) {
      return smsResult('rejected', 0, { reason: 'UNISMS_SENDER_ID must be configured', httpStatus: 400 });
    }
    if (!apiKey || /replace-with|changeme/i.test(apiKey)) {
      return smsResult('rejected', 0, { reason: `A valid ${this.credentialLabel()} is required`, httpStatus: 400 });
    }

    const phNumber = (provider === 'semaphore' || provider === 'iprogsms') ? toPhMobileDigits(recipient) : null;
    if ((provider === 'semaphore' || provider === 'iprogsms') && !phNumber) {
      return smsResult('rejected', 0, {
        reason: `${name} sends only to Philippine mobile numbers (+63XXXXXXXXXX)`,
        httpStatus: 400,
      });
    }
    if (provider === 'semaphore' && startsWithTestWord(message)) {
      return smsResult('rejected', 0, { reason: 'Semaphore drops messages that start with the word TEST; reword the message', httpStatus: 400 });
    }
    if (Date.now() < this.circuitOpenUntil) return smsResult('unavailable', 0, { reason: 'SMS circuit breaker open' });

    const submit = () => {
      if (provider === 'semaphore') {
        return axios.post(SEMAPHORE_ENDPOINT, new URLSearchParams({
          apikey: apiKey, number: phNumber as string, message: message.trim(), ...(senderId ? { sendername: senderId } : {}),
        }).toString(), { timeout: 10000, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      }
      if (provider === 'iprogsms') {
        const base = config.sms.iprogBaseUrl;
        return axios.post(`${base}/sms_messages`, {
          api_token: apiKey,
          phone_number: phNumber,
          message: message.trim(),
          sms_provider: config.sms.iprogNetworkProvider,
        }, {
          timeout: 15000,
          // Cloudflare in front of IPROG rejects bare Node clients without a UA.
          validateStatus: (status) => status < 600,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'AquaSense/1.9 (IPROG SMS client)',
            Accept: 'application/json',
          },
        });
      }
      return axios.post(UNISMS_ENDPOINT, {
        recipient: recipient.trim(), content: message.trim(), sender_id: senderId,
      }, {
        auth: { username: apiKey, password: '' },
        timeout: 10000, headers: { 'Content-Type': 'application/json' },
      });
    };

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await submit();
        this.consecutiveFailures = 0;
        // IPROG may return HTTP 500 with a JSON body explaining Smart/TNT sender rules.
        if (provider === 'iprogsms' && (response.status >= 400 || isIprogRejectionPayload(response.data))) {
          const rejected = parseIprogSendResponse(response.data, response.status, attempt);
          logger.warn(`${name} submission rejected`, { status: rejected.status, httpStatus: response.status });
          return rejected;
        }
        let result = provider === 'semaphore'
          ? parseSemaphoreResponse(response.data, response.status, attempt)
          : provider === 'iprogsms'
            ? parseIprogSendResponse(response.data, response.status, attempt)
            : this.parseUnismsResponse(response.data, response.status, attempt);
        // IPROG often completes within a second; poll once so the UI can show Sent.
        if (provider === 'iprogsms' && result.status === 'pending' && result.referenceId) {
          await new Promise((resolve) => setTimeout(resolve, 1200));
          const polled = await this.getStatus(result.referenceId);
          if (polled.status === 'sent' || polled.status === 'failed') {
            result = { ...polled, retryCount: attempt };
          }
        }
        logger.info(`${name} submission result`, { status: result.status, referenceId: result.referenceId });
        return result;
      } catch (error) {
        const providerError = axios.isAxiosError(error) ? error : undefined;
        const httpStatus = providerError?.response?.status;
        const responseData = providerError?.response?.data;
        const iprogLines = provider === 'iprogsms' ? iprogMessageLines(responseData) : [];
        const errors = provider === 'semaphore'
          ? semaphoreFieldErrors(responseData) ?? (responseData as { errors?: unknown } | undefined)?.errors
          : provider === 'iprogsms' && (iprogLines.length || isIprogRejectionPayload(responseData))
            ? { detail: iprogLines.length ? iprogLines : ['IPROG SMS rejected the request'] }
            : (responseData as { errors?: unknown; error?: unknown; message?: unknown } | undefined)?.errors
              ?? (responseData && typeof responseData === 'object'
                ? { detail: [String((responseData as { error?: unknown; message?: unknown }).error
                  || (responseData as { message?: unknown }).message || 'request failed')] }
                : undefined);
        // Only retry failures known to precede submission. A timeout/reset/5xx
        // may follow acceptance and must not cause a duplicate SMS.
        const safeToRetry = !httpStatus && ['ENOTFOUND', 'EAI_AGAIN', 'ECONNREFUSED'].includes(providerError?.code || '');
        if (safeToRetry && attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 300 * 2 ** attempt));
          continue;
        }
        const iprogRejected = provider === 'iprogsms' && (httpStatus === 500 || isIprogRejectionPayload(responseData) || iprogLines.length > 0);
        const rejected = Boolean(iprogRejected || (httpStatus && httpStatus >= 400 && httpStatus < 500 && httpStatus !== 408));
        const status = rejected ? 'rejected' : safeToRetry ? 'unavailable' : 'unknown';
        if (!rejected && ++this.consecutiveFailures >= config.sms.failureThreshold) {
          this.circuitOpenUntil = Date.now() + config.sms.circuitCooldownMs;
          this.consecutiveFailures = 0;
        }
        logger.warn(`${name} submission not sent`, { status, httpStatus, code: providerError?.code });
        return smsResult(status, attempt, { httpStatus, errors,
          reason: rejected
            ? (iprogLines[0] || 'Provider rejected the SMS; review validation errors')
            : 'Submission not confirmed; verify provider history before resending' });
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
    if (config.sms.provider === 'iprogsms') {
      try {
        const apiKey = config.sms.apiSecretKey || '';
        const response = await axios.get(`${config.sms.iprogBaseUrl}/sms_messages/status`, {
          params: { api_token: apiKey, message_id: referenceId },
          timeout: 10000,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'User-Agent': 'AquaSense/1.9 (IPROG SMS client)',
            Accept: 'application/json',
          },
        });
        return parseIprogStatusResponse(response.data, response.status, referenceId);
      } catch {
        return smsResult('unknown', 0, { referenceId, reason: 'Status lookup unavailable; original submission must not be repeated' });
      }
    }
    try {
      const response = await axios.get(`${UNISMS_ENDPOINT}/${encodeURIComponent(referenceId)}`, {
        auth: { username: config.sms.apiSecretKey || '', password: '' }, timeout: 10000,
      });
      const result = this.parseUnismsResponse(response.data, response.status, 0);
      return result.referenceId === referenceId ? result : smsResult('unknown', 0, { referenceId, reason: 'Provider returned a different reference ID' });
    } catch {
      return smsResult('unknown', 0, { referenceId, reason: 'Status lookup unavailable; original submission must not be repeated' });
    }
  }
}

export const smsService = new SmsService();
