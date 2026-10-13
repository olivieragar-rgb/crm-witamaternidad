import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The web app talks to the local API on :3001 through a dev proxy,
// so the browser only ever sees one origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3001', // API_PORT por defecto
    },
  },
});
