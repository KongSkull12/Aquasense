import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appVersion = (JSON.parse(readFileSync(`${__dirname}/package.json`, 'utf8')) as { version: string }).version;
// Vercel sets VERCEL_GIT_COMMIT_SHA during builds; local builds have no commit.
const appCommit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7);

// esptool-js loads its flasher stubs with import('./x.json', { with: { type: 'json' } }).
// Vite leaves imports with that attribute unbundled, so the deployed Firmware update
// page requested a file that does not exist. Without the attribute, Vite bundles each
// stub as an ordinary JSON chunk.
const esptoolStubJson = (): Plugin => ({
  name: 'aquasense:esptool-stub-json',
  enforce: 'pre',
  transform(code, id) {
    if (!id.replace(/\\/g, '/').includes('/esptool-js/lib/stubFlasher.js')) return null;
    return { code: code.replace(/,\s*\{\s*with:\s*\{\s*type:\s*"json"\s*\}\s*\}/g, ''), map: null };
  },
});

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const backendUrl = mode === 'public-dev' || mode === 'development' ? 'http://localhost:5002' : 'http://localhost:5001';
  return {
  plugins: [react(), esptoolStubJson()],
  define: {
    __APP_VERSION__: JSON.stringify(appVersion),
    __APP_COMMIT__: JSON.stringify(appCommit),
  },
  server: {
    port: 3000,
    open: true,
    proxy: {
      '/api': {
        target: backendUrl,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    minify: 'terser',
  },
  resolve: {
    alias: {
      '@': `${__dirname}/src`,
      '@components': `${__dirname}/src/components`,
      '@pages': `${__dirname}/src/pages`,
      '@hooks': `${__dirname}/src/hooks`,
      '@utils': `${__dirname}/src/utils`,
      '@types': `${__dirname}/src/types`,
      '@services': `${__dirname}/src/services`,
    },
  },
  };
});
