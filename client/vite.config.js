import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev`        -> http, reachable on your LAN (phone camera app can open labels)
// `npm run dev:phone`  -> https, so the in-app live camera scanner also works on a phone
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { host: true, port: 5173, proxy: { '/api': 'http://localhost:4000' } },
}));
