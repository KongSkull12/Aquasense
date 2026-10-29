const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const http = require('node:http');
const { spawn } = require('node:child_process');
const dotenv = require('dotenv');
const PUBLIC_DEV_BROKER_URL = 'mqtt://broker.hivemq.com:1883';
const PUBLIC_DEV_DEVICE_ID = 'esp32-feeder-1';

const backendDir = path.resolve(__dirname, '..');

function readJson(url) {
  return new Promise((resolve, reject) => {
    const request = http.get(url, (response) => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => {
        body += chunk;
        if (body.length > 16384) request.destroy(new Error('Unexpected health response'));
      });
      response.on('error', reject);
      response.on('end', () => {
        try {
          if (response.statusCode !== 200) throw new Error('Health check failed');
          resolve(JSON.parse(body));
        } catch (error) { reject(error); }
      });
    });
    request.setTimeout(2000, () => request.destroy(new Error('Health check timed out')));
    request.on('error', reject);
  });
}

async function checkStartup(host, port) {
  const available = await new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.once('error', (error) => {
      if (error.code === 'EADDRINUSE') resolve(false);
      else reject(error);
    });
    probe.listen(port, host, () => probe.close(() => resolve(true)));
  });
  if (available) return 'available';

  const checkHost = host === '0.0.0.0' ? '127.0.0.1' : host === '::' ? '[::1]' : host.includes(':') ? `[${host}]` : host;
  const baseUrl = `http://${checkHost}:${port}`;
  try {
    const [health, root] = await Promise.all([readJson(`${baseUrl}/health`), readJson(baseUrl)]);
    if (health.success === true && health.message === 'Server is healthy' &&
        root.message === 'Welcome to Capstone Backend API - Water Quality IoT System') {
      return 'running';
    }
  } catch {
    // An occupied port alone does not prove that AquaSense is healthy.
  }
  throw new Error(`Port ${port} is occupied, but a healthy AquaSense backend could not be verified. Check the terminal for the existing process before restarting it.`);
}

async function main() {
  const args = process.argv.slice(2);
  const publicDev = args.includes('--profile') && args[args.indexOf('--profile') + 1] === 'public-dev';
  if (args.some((arg, index) => arg === '--profile' && args[index + 1] !== 'public-dev') ||
      args.filter((arg) => arg === '--profile').length > 1) {
    throw new Error('Only the explicit --profile public-dev option is supported');
  }
  const envPath = path.join(backendDir, publicDev ? '.env.public-dev' : '.env');
  const fileEnv = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};
  if (publicDev) {
    if (fileEnv.MQTT_BROKER_URL !== PUBLIC_DEV_BROKER_URL ||
        (process.env.MQTT_BROKER_URL !== undefined && process.env.MQTT_BROKER_URL !== PUBLIC_DEV_BROKER_URL)) {
      throw new Error('Public development profile requires the exact configured HiveMQ broker URL');
    }
    if ((fileEnv.FEEDER_DEVICE_ID !== undefined && fileEnv.FEEDER_DEVICE_ID !== PUBLIC_DEV_DEVICE_ID) ||
        (process.env.FEEDER_DEVICE_ID !== undefined && process.env.FEEDER_DEVICE_ID !== PUBLIC_DEV_DEVICE_ID)) {
      throw new Error('Public development profile device ID must match the firmware configuration');
    }
    if (!fileEnv.PORT || (process.env.PORT !== undefined && process.env.PORT !== fileEnv.PORT)) {
      throw new Error('Public development profile server port must match its profile configuration');
    }
    if (fileEnv.MQTT_DEVICE_SCOPED_TOPICS !== 'true' || fileEnv.MQTT_ACTUATOR_COMMANDS_ENABLED !== 'true' ||
        fileEnv.MQTT_PUBLIC_COMMANDS_ENABLED !== 'true' ||
        !/^[A-Za-z0-9_-]{3,48}$/.test(fileEnv.MQTT_TOPIC_NAMESPACE || '') ||
        !/^[A-Za-z0-9_-]{3,48}$/.test(fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE || '') ||
        fileEnv.MQTT_TOPIC_NAMESPACE === fileEnv.MQTT_CONTROL_TOPIC_NAMESPACE) {
      throw new Error('Public development profile settings are incomplete or unsafe');
    }
  }
  const host = fileEnv.HOST ?? process.env.HOST ?? 'localhost';
  const port = Number((publicDev ? fileEnv.PORT : fileEnv.PORT ?? process.env.PORT) ?? '5001');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be an integer between 1 and 65535 in Backend/.env');

  if (await checkStartup(host || 'localhost', port) === 'running') {
    console.log(`AquaSense backend is already running and healthy on port ${port}. No second instance was started.`);
    console.log('Use the existing backend terminal. To restart it, stop that instance with Ctrl+C before running npm run dev again.');
    return;
  }

  const childArgs = args.filter((arg, index) => !(arg === '--profile' || args[index - 1] === '--profile'));
  const childEnv = { ...process.env, ...(publicDev ? { AQUASENSE_CONFIG_PROFILE: 'public-dev' } : {}) };
  const child = spawn(process.execPath, [require.resolve('nodemon/bin/nodemon.js'), '--exec', 'ts-node', 'src/server.ts', ...childArgs], {
    cwd: backendDir,
    stdio: 'inherit',
    env: childEnv,
  });
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));
  child.on('error', (error) => { console.error(error.message); process.exitCode = 1; });
  child.on('exit', (code, signal) => { process.exitCode = code ?? (signal === 'SIGINT' || signal === 'SIGTERM' ? 0 : 1); });
}

module.exports = { checkStartup };
if (require.main === module) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
