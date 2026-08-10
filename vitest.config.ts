import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
  resolve: {
    alias: {
      // The obsidian npm package ships types only (no runtime entry).
      // Tests that exercise services importing it get a stub.
      obsidian: resolve(process.cwd(), 'tests/__mocks__/obsidian.ts'),
    },
  },
});
