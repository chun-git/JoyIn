import path from 'node:path';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, 'shared'),
    },
  },
  test: {
    name: 'web',
    environment: 'happy-dom',
    include: ['web/src/**/*.test.ts', 'web/src/**/*.test.tsx'],
    setupFiles: ['web/src/test/setup.ts'],
  },
});
