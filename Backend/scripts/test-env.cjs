// Loaded before application imports. These tests must never contact a provider,
// broker or database, even if a developer has real credentials configured.
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'isolated-test-secret-not-for-deployment-123456';
process.env.UNISMS_API_SECRET_KEY = 'unit-test-key';
process.env.UNISMS_SENDER_ID = 'Test';
process.env.FARMER_PHONE = '';
process.env.DEVICE_KEYS = '';
process.env.DB_PASSWORD = 'isolated-test-password';
const blocked = () => { throw new Error('External I/O blocked by isolated test bootstrap; mock this dependency'); };
require('axios').defaults.adapter = blocked;
require('mqtt').connect = blocked;
require('pg').Client.prototype.connect = blocked;
