import type { MigrationStep } from './types';

// The production format is still v1. When it becomes v2, add a pure 1 -> 2
// step here, fixtures for v1, and the corresponding specification/authoring
// kit updates. Future-version raw data must remain protected.
export const TEMPLATE_MIGRATIONS: readonly MigrationStep[] = [];
export const NOTE_STYLE_MIGRATIONS: readonly MigrationStep[] = [];
