import assert from 'node:assert/strict';
import test from 'node:test';
import { collectSmsPhones, normalizeSmsPhone, SMS_RECIPIENT_LIMIT } from './smsRecipients';

test('phone numbers normalize to E.164 and keep at most four unique values', () => {
  assert.equal(normalizeSmsPhone('09171234567'), '+639171234567');
  assert.equal(normalizeSmsPhone('639171234567'), '+639171234567');
  assert.equal(normalizeSmsPhone('+639171234567'), '+639171234567');
  assert.equal(normalizeSmsPhone('0917 123 4567'), '+639171234567');
  assert.equal(normalizeSmsPhone('12345'), null);

  const collected = collectSmsPhones(['09171234567', '+639171234567', '09180000000', 'not-a-number']);
  assert.deepEqual(collected.phones, ['+639171234567', '+639180000000']);
  assert.equal(SMS_RECIPIENT_LIMIT, 4);
  assert.deepEqual(collected.invalid, ['not-a-number']);
});
