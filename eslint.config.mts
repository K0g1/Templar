import obsidianmd from 'eslint-plugin-obsidianmd';
import globals from 'globals';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig(
  globalIgnores([
    'node_modules',
    'main.js',
    'coverage',
    'esbuild.config.mjs',
    'version-bump.mjs',
    'versions.json',
    'package-lock.json',
  ]),
  {
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            'eslint.config.mts',
            'manifest.json',
            'scripts/verify-mobile-bundle.mjs',
            'scripts/verify-release.mjs',
          ],
        },
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.json'],
      },
    },
  },
  ...obsidianmd.configs.recommended,
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
