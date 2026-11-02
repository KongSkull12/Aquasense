import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { fileURLToPath } from 'url';
import { dirname } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const appVersion = (JSON.parse(readFileSync(`${__dirname}/package.json`, 'utf8')) as { version: string }).version;
// Vercel sets VERCEL_GIT_COMMIT_SHA during builds; local builds have no commit.
const appCommit = (process.env.VERCEL_GIT_COMMIT_SHA || process.env.GIT_COMMIT || '').slice(0, 7);

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const backendUrl = mode === 'public-dev' || mode === 'development' ? 'http://localhost:5002' : 'http://localhost:5001';
  return {
  plugins: [react()],
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
