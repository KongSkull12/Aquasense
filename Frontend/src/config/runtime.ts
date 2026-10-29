// The default Vite development mode uses the same public telemetry backend as
// public-dev. Use `npm run dev:local` (mode private-api) when connecting to the private port-5001 API.
const PUBLIC_DEV_MODE = import.meta.env.MODE === 'public-dev' || import.meta.env.MODE === 'development';
const LOCAL_BACKEND_URL = PUBLIC_DEV_MODE ? 'http://localhost:5002' : 'http://localhost:5001';

const trimTrailingSlashes = (value: string): string => value.replace(/\/+$/, '');

export const API_BASE_URL = trimTrailingSlashes(PUBLIC_DEV_MODE
  ? `${LOCAL_BACKEND_URL}/api/v1`
  : (import.meta.env.VITE_API_URL as string | undefined) || `${LOCAL_BACKEND_URL}/api/v1`);

export const WEBSOCKET_URL = trimTrailingSlashes(PUBLIC_DEV_MODE
  ? LOCAL_BACKEND_URL
  : (import.meta.env.VITE_WS_URL as string | undefined) || LOCAL_BACKEND_URL);
