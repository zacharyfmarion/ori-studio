import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5176,
    proxy: {
      '/api': 'http://127.0.0.1:8788',
      '/assets': 'http://127.0.0.1:8788',
    },
  },
});
