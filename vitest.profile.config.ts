import baseConfig from './vitest.config';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...(baseConfig.test ?? {}),
    include: ['tests/profile-synthetic-harness.profile.ts'],
  },
});
