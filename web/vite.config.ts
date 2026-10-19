import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': { target: 'http://localhost:8080', ws: true },
      '/uploads': 'http://localhost:8080',
      '/docs': 'http://localhost:8080',
    },
  },
  build: { target: 'es2022', chunkSizeWarningLimit: 900 },
});
