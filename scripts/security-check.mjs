import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const output = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
const files = output.split('\0').filter(Boolean);

const ignoredContentPaths = [
  /(^|\/)node_modules\//,
  /(^|\/)dist\//,
  /package-lock\.json$/,
  /SECURITY_HISTORY_PURGE_PR\.md$/,
  /scripts\/security-check\.mjs$/,
];

const failures = [];

const isEnvFile = (file) => /(^|\/)\.env($|\.)/.test(file) && !file.endsWith('.env.example');

for (const file of files) {
  const normalized = file.replaceAll('\\', '/');

  if (isEnvFile(normalized)) {
    failures.push(`Tracked secret-bearing env file: ${file}`);
    continue;
  }

  if (ignoredContentPaths.some((pattern) => pattern.test(normalized))) {
    continue;
  }

  let content = '';
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  if (/your_jwt_secret_key_change_in_production|change_in_production_12345/i.test(content)) {
    failures.push(`Default JWT placeholder committed in ${file}`);
  }

  if (/UNISMS_API_SECRET_KEY\s*=\s*sk_[A-Za-z0-9_-]+/.test(content)) {
    failures.push(`Live-looking UniSMS secret committed in ${file}`);
  }

  if (/JWT_SECRET\s*=\s*(?!replace-with|example|changeme)[^\s#]{16,}/i.test(content) && !normalized.endsWith('.env.example')) {
    failures.push(`Live-looking JWT_SECRET assignment committed in ${file}`);
  }

  if (
    !/\.(md|txt)$/i.test(normalized) &&
    /NODE_ENV\s*=\s*production/i.test(content) &&
    /CORS_ORIGIN\s*=\s*.*localhost/i.test(content)
  ) {
    failures.push(`Production localhost CORS committed in ${file}`);
  }
}

if (process.env.NODE_ENV === 'production' && /localhost|127\.0\.0\.1|\[::1\]/i.test(process.env.CORS_ORIGIN || '')) {
  failures.push('Production CORS_ORIGIN must not include localhost');
}

if (process.env.NODE_ENV === 'production' && /change_in_production|your_jwt_secret|changeme/i.test(process.env.JWT_SECRET || '')) {
  failures.push('Production JWT_SECRET must not use a default placeholder');
}

if (failures.length > 0) {
  console.error('Security check failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('Security check passed.');
