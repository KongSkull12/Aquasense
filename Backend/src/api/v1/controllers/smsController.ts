/**
 * SMS test controller
 */
import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../../../utils/response';
import { describeSmsFailure, isValidSmsRecipient, validateSmsMessage, type SmsSendResult } from '../../../services/sms.service';
import { smsNotificationService } from '../../../services/smsNotification.service';
import { config } from '../../../config/config';
import { DEFAULT_TEST_SMS } from '../../../services/smsTemplate.service';
import { logger } from '../../../utils/logger';
import type { AuthenticatedRequest } from '../../../middleware/authMiddleware';
import { collectSmsPhones, saveSmsRecipients, smsRecipientsForUser, SMS_RECIPIENT_LIMIT } from '../../../services/smsRecipients';

const maskPhone = (phone: string) => (phone.length < 7 ? 'Hidden' : `${phone.slice(0, 4)}***${phone.slice(-2)}`);

const replyWithResults = (res: Response, recipients: string[], results: SmsSendResult[] | null, emptyMessage: string): void => {
  if (results === null) {
    sendError(res, 409, 'A recent SMS is pending or cooling down; check SMS logs before retrying');
    return;
  }
  if (!results.length) {
    sendError(res, 400, emptyMessage);
    return;
  }
  const accepted = results.filter((result) => result.accepted).length;
  const summary = results.map((result, index) => ({
    recipient: maskPhone(recipients[index] || ''),
    status: result.status,
    accepted: result.accepted,
  }));
  if (!accepted) {
    const detail = describeSmsFailure(results);
    sendError(res, results.some((result) => result.status === 'rejected') ? 422 : 502, detail ? `SMS was not confirmed sent. ${detail}` : 'SMS was not confirmed sent', { results: summary });
    return;
  }
  const allSent = results.every((result) => result.success);
  sendSuccess(res, allSent ? 200 : 202, allSent ? `Provider reports SMS sent to ${accepted} number${accepted === 1 ? '' : 's'}` : `SMS accepted for ${accepted} of ${results.length} numbers; awaiting provider status`, { results: summary });
};

export const getSmsRecipients = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      sendError(res, 401, 'Sign in required');
      return;
    }
    sendSuccess(res, 200, 'SMS recipients', await smsRecipientsForUser(req.userId));
  } catch (error) {
    logger.error('Failed to load SMS recipients', error);
    sendError(res, 500, 'Failed to load SMS recipients');
  }
};

export const saveSmsRecipientsHandler = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  try {
    if (!req.userId) {
      sendError(res, 401, 'Sign in required');
      return;
    }
    const payload = req.body as { enabled: boolean; phones: string[] };
    const collected = collectSmsPhones(payload.phones);
    if (collected.invalid.length) {
      sendError(res, 400, 'Enter each number as 09XXXXXXXXX or +639XXXXXXXXX');
      return;
    }
    if (collected.phones.length > SMS_RECIPIENT_LIMIT) {
      sendError(res, 400, `Save at most ${SMS_RECIPIENT_LIMIT} mobile numbers`);
      return;
    }
    const saved = await saveSmsRecipients(req.userId, payload.enabled, collected.phones);
    sendSuccess(res, 200, 'SMS recipients saved', saved);
  } catch (error) {
    logger.error('Failed to save SMS recipients', error);
    sendError(res, 500, 'Failed to save SMS recipients');
  }
};

export const sendTestSms = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body as { recipient?: string; message?: string };
    const message = payload.message || DEFAULT_TEST_SMS;
    const messageValidation = validateSmsMessage(message);
    if (!messageValidation.valid) {
      sendError(res, 400, messageValidation.reason || 'Invalid SMS message');
      return;
    }

    if (payload.recipient) {
      if (!isValidSmsRecipient(payload.recipient)) {
        sendError(res, 400, 'Invalid phone number format. Use E.164 format (e.g. +639171234567)');
        return;
      }
      const result = await smsNotificationService.send({ deviceId: 'sms-test', category: 'SMS_TEST', severity: 'INFO', recipient: payload.recipient, message });
      replyWithResults(res, [payload.recipient], result ? [result] : null, 'Recipient phone number is required');
      return;
    }

    const userId = (req as AuthenticatedRequest).userId;
    const recipients = userId ? (await smsRecipientsForUser(userId)).phones : (config.farm.recipientPhone ? [config.farm.recipientPhone] : []);
    const results = await smsNotificationService.sendEach({
      deviceId: 'sms-test', category: 'SMS_TEST', severity: 'INFO', recipients, message,
    });
    replyWithResults(res, recipients, results, 'Add a mobile number before sending a test');
  } catch (error) {
    logger.error('Failed to send SMS test', error);
    sendError(res, 500, 'Failed to send SMS test');
  }
};
