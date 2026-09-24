import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['shared/__tests__/**/*.test.ts', 'server/__tests__/**/*.test.ts'],
    environment: 'node',
  },
});
