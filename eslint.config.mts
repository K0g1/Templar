import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    'main.js',
    '.release',
    'coverage',
    'perf-results',
    'Templar_Performance_Benchmark_*.zip',
    'Templar_Performance_Benchmark_*.zip.sha256',
    'esbuild.config.mjs',
    'version-bump.mjs',
    'versions.json',
    'package-lock.json',
    // The Astro website has its own type-aware checks and generated output.
    'website',
  ]),
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          maximumDefaultProjectFileMatchCount_THIS_WILL_SLOW_DOWN_LINTING: 20,
          allowDefaultProject: [
            'eslint.config.mts',
            'manifest.json',
            'scripts/verify-mobile-bundle.mjs',
            'scripts/verify-release.mjs',
            'scripts/update-builtin-fingerprints.mjs',
            'scripts/verify-runtime-policy.mjs',
            'scripts/verify-brat-release.mjs',
            'scripts/verify-ship.mjs',
            'scripts/stage-release.mjs',
            'scripts/generate-benchmark-fixtures.mjs',
            'scripts/run-profile-synthetic.mjs',
            'scripts/aggregate-performance-results.mjs',
            'scripts/run-overhead-calibration.mjs',
            'vitest.config.ts',
            'vitest.profile.config.ts',
            'vitest.overhead.config.ts',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          { group: ['node:*', 'electron'], message: 'Node and Electron APIs are not available in the Obsidian runtime.' },
        ],
      }],
      'no-restricted-globals': ['error',
        { name: 'Buffer', message: 'Use browser-compatible APIs in runtime source.' },
        { name: 'EventSource', message: 'Network APIs are not part of Templar runtime policy.' },
        { name: 'fetch', message: 'Network APIs are not part of Templar runtime policy.' },
        { name: 'process', message: 'Node APIs are not available in the Obsidian runtime.' },
        { name: 'require', message: 'Dynamic Node loading is not available in the Obsidian runtime.' },
        { name: 'WebSocket', message: 'Network APIs are not part of Templar runtime policy.' },
        { name: 'XMLHttpRequest', message: 'Network APIs are not part of Templar runtime policy.' },
      ],
      'no-restricted-properties': ['error', {
        object: 'navigator',
        property: 'sendBeacon',
        message: 'Network APIs are not part of Templar runtime policy.',
      }],
      'no-restricted-syntax': ['error', {
        selector: "Identifier[name='FileSystemAdapter']",
        message: 'FileSystemAdapter requires an explicitly reviewed desktop-only exception.',
      }],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/rule-custom-message': 'off',
    },
  },
  {
    files: ['tests/**/*.test.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      // Test-only tooling never ships in the mobile runtime bundle.
      'obsidianmd/no-nodejs-modules': 'off',
    },
  },
  {
    files: ['tests/**/*.profile.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
      'obsidianmd/no-tfile-tfolder-cast': 'off',
    },
  },
  {
    files: [
      'tests/frontmatter.test.ts',
      'tests/frontmatter.integration.test.ts',
      'tests/page-renderer.integration.test.ts',
      'tests/print-service.lifecycle.integration.test.ts',
      'tests/style-application.test.ts',
      'tests/style-rule-engine.test.ts',
    ],
    rules: {
      // These tests intentionally use minimal TFile-shaped fixtures instead
      // of requiring a live Obsidian vault and file manager.
      'obsidianmd/no-tfile-tfolder-cast': 'off',
    },
  },
  {
    files: ['vitest.config.ts', 'vitest.profile.config.ts', 'vitest.overhead.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      'obsidianmd/no-nodejs-modules': 'off',
    },
  },
  {
    // This integration test deliberately exercises the renderer's owned
    // <style> lifecycle; the element is never part of the plugin UI.
    files: ['tests/rendering-controllers.test.ts'],
    rules: {
      'obsidianmd/no-forbidden-elements': 'off',
      'obsidianmd/prefer-create-el': 'off',
      'obsidianmd/ui/sentence-case': 'off',
    },
  },
  {
    // Templar supports Obsidian 1.8+, so it intentionally keeps the imperative
    // settings API. The 1.13 declarative API cannot replace this UI without
    // dropping the supported stable versions.
    rules: {
      'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
    },
  },
  {
    // Obsidian Mobile may deny the modern Clipboard API in its WebView. This
    // one compatibility helper intentionally retains the selection fallback.
    files: ['src/utils/clipboard.ts'],
    rules: {
      '@typescript-eslint/no-deprecated': 'off',
    },
  },
);
