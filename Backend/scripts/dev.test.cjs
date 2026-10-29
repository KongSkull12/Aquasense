const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { checkStartup } = require('./dev.cjs');

async function serve(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server.address().port;
}

test('an available port permits normal startup', async () => {
  assert.equal(await checkStartup('127.0.0.1', 0), 'available');
});

test('a healthy AquaSense instance prevents a duplicate startup', async (t) => {
  const port = await serve(t, (req, res) => res.end(JSON.stringify({
    success: true,
    message: req.url === '/health' ? 'Server is healthy' : 'Welcome to Capstone Backend API - Water Quality IoT System',
  })));
  assert.equal(await checkStartup('127.0.0.1', port), 'running');
});

test('an unrelated service is not reported as a healthy backend', async (t) => {
  const port = await serve(t, (_req, res) => res.end(JSON.stringify({ success: true, message: 'Server is healthy' })));
  await assert.rejects(checkStartup('127.0.0.1', port), /occupied.*could not be verified/);
});

test('an unhealthy backend reports an actionable port conflict', async (t) => {
  const port = await serve(t, (_req, res) => { res.statusCode = 503; res.end('{}'); });
  await assert.rejects(checkStartup('127.0.0.1', port), /occupied.*could not be verified/);
});
