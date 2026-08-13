import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const benchmarkSourceCommit = process.env.TEMPLAR_BENCHMARK_SOURCE_COMMIT ?? 'b63adb76ed1843d17b680244370085a0002fc89a';
const instrumentationCommit = process.env.TEMPLAR_INSTRUMENTATION_COMMIT ?? 'test-harness';

export default defineConfig({
  // Unit tests exercise the profile-only aggregation code. Release builds
  // still define this constant as false in esbuild.config.mjs.
  define: {
    __TEMPLAR_PERF__: 'true',
    __TEMPLAR_PERF_SOURCE_COMMIT__: JSON.stringify(benchmarkSourceCommit),
    __TEMPLAR_PERF_INSTRUMENTATION_COMMIT__: JSON.stringify(instrumentationCommit),
  },
  resolve: {
    alias: {
      obsidian: fileURLToPath(new URL('./tests/harness/obsidian-runtime.ts', import.meta.url)),
    },
  },
  test: {
    benchmark: {
      includeSamples: true,
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      reportsDirectory: './coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/main.ts', 'src/types.ts'],
    },
  },
});
