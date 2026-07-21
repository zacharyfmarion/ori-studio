import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

const crossOriginIsolationHeaders = {
  'Cross-Origin-Embedder-Policy': 'require-corp',
  'Cross-Origin-Opener-Policy': 'same-origin',
};

export default defineConfig({
  plugins: [react()],
  server: {
    headers: crossOriginIsolationHeaders,
  },
  preview: {
    headers: crossOriginIsolationHeaders,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
  },
});
