import fs from 'fs';
import path from 'path';

export interface BuildInfo {
  version: string;
  commit: string | null;
}

const readPackageVersion = (): string => {
  try {
    // Resolves to Backend/package.json from both src/config (ts-node) and dist/config (node).
    const packageJson = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'package.json'), 'utf8')) as { version?: string };
    return packageJson.version || 'unknown';
  } catch {
    return 'unknown';
  }
};

// Render sets RENDER_GIT_COMMIT for every deploy; GIT_COMMIT covers other hosts.
const commit = (process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '').trim().slice(0, 7);

export const buildInfo: BuildInfo = {
  version: readPackageVersion(),
  commit: commit || null,
};
