import test from 'node:test';
import assert from 'node:assert/strict';
import { config, validateConfiguration } from '../config/config';

test('configuration requires a strong JWT secret', () => {
  const missing = validateConfiguration({ ...config, jwt: { ...config.jwt, secret: '' } }, 'development');
  assert.ok(missing.some((issue) => issue.includes('JWT_SECRET')));

  const short = validateConfiguration({ ...config, jwt: { ...config.jwt, secret: 'too-short' } }, 'development');
  assert.ok(short.some((issue) => issue.includes('32 characters')));

  const valid = validateConfiguration({ ...config, jwt: { ...config.jwt, secret: 'a'.repeat(48) } }, 'development');
  assert.equal(valid.some((issue) => issue.includes('JWT_SECRET')), false);
});

test('UniSMS credentials are optional and missing values do not invalidate core configuration', () => {
  const issues = validateConfiguration({
    ...config,
    jwt: { ...config.jwt, secret: 'a'.repeat(48) },
    sms: { ...config.sms, apiSecretKey: undefined, senderId: undefined },
  }, 'development');
  assert.equal(issues.some((issue) => issue.includes('UNISMS_API_SECRET_KEY')), false);
});

test('database credentials cannot remain template placeholders', () => {
  const issues = validateConfiguration({
    ...config,
    jwt: { ...config.jwt, secret: 'a'.repeat(48) },
    database: { ...config.database, password: '<your-local-database-password>' },
  }, 'development');
  assert.ok(issues.some((issue) => issue.includes('DB_PASSWORD')));
});

test('production authentication configuration remains strict without exposing secret values', () => {
  const secret = 'super-secret-value-that-must-not-be-reported';
  const issues = validateConfiguration({
    ...config,
    jwt: { ...config.jwt, secret },
    device: { ...config.device, keys: {} },
  }, 'production');
  assert.ok(issues.some((issue) => issue.includes('DEVICE_KEYS')));
  assert.equal(issues.some((issue) => issue.includes(secret)), false);
});
