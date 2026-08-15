import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Listen on every interface, not just localhost, so a phone or a laptop on
    // the same WiFi can reach a trial run. Only ever the dev server — the
    // production build is served by nginx.
    host: true,
    port: 5173,
    strictPort: true,
    proxy: {
      // Keeps the session cookie first-party in development.
      '/api': { target: 'http://localhost:4000', changeOrigin: true },
      '/uploads': { target: 'http://localhost:4000', changeOrigin: true },
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
});
