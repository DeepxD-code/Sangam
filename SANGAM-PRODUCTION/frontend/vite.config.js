import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SANGAM Command Dashboard — Vite config (Day 27)
//
// Dev server proxies /api to the backend Express server so the React app
// can call relative paths ('/api/dashboard/summary') without CORS friction
// during local development. In production, the backend serves the built
// frontend statically (see backend/src/app.js Day 28+ static mount, or
// reverse-proxy via nginx in docker-compose).
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://localhost:3000',
        changeOrigin: true
      }
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true
  }
});
