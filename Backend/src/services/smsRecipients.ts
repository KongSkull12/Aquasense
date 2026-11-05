import { config } from '../config/config';
import { Device } from '../database/models/Device';
import { SmsRecipientSetting } from '../database/models/SmsRecipientSetting';
import { isValidSmsRecipient } from './sms.service';
import { logger } from '../utils/logger';

export const SMS_RECIPIENT_LIMIT = 4;

export interface SmsRecipientList {
  enabled: boolean;
  phones: string[];
  saved: boolean;
}

/** Accept E.164, or a Philippine mobile written as 09XXXXXXXXX or 639XXXXXXXXX. */
export const normalizeSmsPhone = (input: string): string | null => {
  const compact = input.trim().replace(/[\s()-]/g, '');
  if (!compact) return null;
  let phone = compact;
  if (/^09\d{9}$/.test(compact)) phone = `+63${compact.slice(1)}`;
  else if (/^639\d{9}$/.test(compact)) phone = `+${compact}`;
  return isValidSmsRecipient(phone) ? phone : null;
};

export const collectSmsPhones = (inputs: string[]): { phones: string[]; invalid: string[] } => {
  const phones: string[] = [];
  const invalid: string[] = [];
  for (const raw of inputs) {
    if (!raw.trim()) continue;
    const phone = normalizeSmsPhone(raw);
    if (!phone) invalid.push(raw.trim());
    else if (!phones.includes(phone)) phones.push(phone);
  }
  return { phones, invalid };
};

const serverPhone = (): string[] => {
  const phone = normalizeSmsPhone(config.farm.recipientPhone || '');
  return phone ? [phone] : [];
};

const storedPhones = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((phone): phone is string => typeof phone === 'string' && isValidSmsRecipient(phone)).slice(0, SMS_RECIPIENT_LIMIT) : [];

export const smsRecipientsForUser = async (userId: string): Promise<SmsRecipientList> => {
  if (!SmsRecipientSetting.sequelize) return { enabled: serverPhone().length > 0, phones: serverPhone(), saved: false };
  const row = await SmsRecipientSetting.findOne({ where: { userId } });
  if (!row) return { enabled: serverPhone().length > 0, phones: serverPhone(), saved: false };
  return { enabled: row.enabled, phones: storedPhones(row.phones), saved: true };
};

export const saveSmsRecipients = async (userId: string, enabled: boolean, phones: string[]): Promise<SmsRecipientList> => {
  const existing = await SmsRecipientSetting.findOne({ where: { userId } });
  const row = existing
    ? await existing.update({ enabled, phones })
    : await SmsRecipientSetting.create({ userId, enabled, phones });
  return { enabled: row.enabled, phones: storedPhones(row.phones), saved: true };
};

/** Numbers that should receive an automatic alert for this device. An explicit off switch sends none. */
export const alertPhonesForDevice = async (deviceId: string): Promise<string[]> => {
  try {
    if (!Device.sequelize || !SmsRecipientSetting.sequelize) return serverPhone();
    const device = await Device.findOne({ where: { deviceId } });
    if (!device) return serverPhone();
    const list = await smsRecipientsForUser(device.userId);
    if (!list.saved) return serverPhone();
    return list.enabled ? list.phones : [];
  } catch (error) {
    logger.warn('Could not load SMS recipients', { deviceId, error: error instanceof Error ? error.message : String(error) });
    return [];
  }
};
