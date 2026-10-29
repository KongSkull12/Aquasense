/**
 * SMS test controller
 */
import { Request, Response } from 'express';
import { sendError, sendSuccess } from '../../../utils/response';
import { isValidSmsRecipient, validateSmsMessage } from '../../../services/sms.service';
import { smsNotificationService } from '../../../services/smsNotification.service';
import { config } from '../../../config/config';
import { DEFAULT_TEST_SMS } from '../../../services/smsTemplate.service';
import { logger } from '../../../utils/logger';

export const sendTestSms = async (req: Request, res: Response): Promise<void> => {
  try {
    const payload = req.body as { recipient?: string; message?: string };
    const recipient = payload.recipient || config.farm.recipientPhone;
    const message = payload.message || DEFAULT_TEST_SMS;

    if (!recipient) {
      sendError(res, 400, 'Recipient phone number is required');
      return;
    }
    if (!isValidSmsRecipient(recipient)) {
      sendError(res, 400, 'Invalid phone number format. Use E.164 format (e.g. +639171234567)');
      return;
    }

    const messageValidation = validateSmsMessage(message);
    if (!messageValidation.valid) {
      sendError(res, 400, messageValidation.reason || 'Invalid SMS message');
      return;
    }

    const result = await smsNotificationService.send({ deviceId: 'sms-test', category: 'SMS_TEST', severity: 'INFO', recipient, message });
    if (!result) {
      sendError(res, 409, 'A recent SMS test is pending or cooling down; check SMS logs before retrying');
      return;
    }
    if (!result.accepted) {
      let details: Record<string, unknown> = { raw: result.response };
      try {
        const parsed: unknown = JSON.parse(result.response);
        if (parsed && typeof parsed === 'object') details = parsed as Record<string, unknown>;
      } catch (parseError) {
        logger.debug('SMS provider returned a non-JSON error response', { error: String(parseError) });
      }
      sendError(res, result.status === 'rejected' ? 422 : 502, 'SMS was not confirmed sent', {
        status: result.status, providerHttpStatus: result.httpStatus, details,
      });
      return;
    }

    sendSuccess(res, result.success ? 200 : 202, result.success ? 'Provider reports SMS sent' : 'SMS accepted; awaiting provider status', {
      success: result.success,
      retryCount: result.retryCount,
      providerResponse: result.response,
      status: result.status,
      referenceId: result.referenceId,
    });
  } catch (error) {
    logger.error('Failed to send SMS test', error);
    sendError(res, 500, 'Failed to send SMS test');
  }
};
