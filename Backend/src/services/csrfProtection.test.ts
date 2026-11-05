import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import { config } from '../config/config';
import { csrfProtection } from '../middleware/csrfProtection';

test('a stale session cookie does not block sign-in or sign-up, but still guards other writes', async () => {
  const app = express();
  app.use(csrfProtection);
  app.post('/api/v1/auth/login', (_req, res) => { res.sendStatus(200); });
  app.post('/api/v1/auth/signup', (_req, res) => { res.sendStatus(201); });
  app.post('/api/v1/auth/logout', (_req, res) => { res.sendStatus(200); });
  app.put('/api/v1/sms/recipients', (_req, res) => { res.sendStatus(200); });
  const server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const staleCookie = `${config.authCookie.name}=old-session; aquasense_csrf=old-token`;
  const send = (method: string, path: string, csrf?: string) => fetch(base + path, {
    method,
    headers: { Cookie: staleCookie, ...(csrf ? { 'X-CSRF-Token': csrf } : {}) },
  });

  try {
    assert.equal((await send('POST', '/api/v1/auth/login')).status, 200);
    assert.equal((await send('POST', '/api/v1/auth/signup')).status, 201);
    assert.equal((await send('POST', '/api/v1/auth/logout')).status, 403);
    assert.equal((await send('PUT', '/api/v1/sms/recipients')).status, 403);
    assert.equal((await send('PUT', '/api/v1/sms/recipients', 'wrong-token')).status, 403);
    assert.equal((await send('PUT', '/api/v1/sms/recipients', 'old-token')).status, 200);
  } finally {
    server.close();
  }
});
