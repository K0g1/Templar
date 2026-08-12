import type { MigrationStep } from './types';

// Pack format remains v1. Future pack wrappers are protected before member
// normalization so a newer pack cannot be silently default-filled.
export const PACK_MIGRATIONS: readonly MigrationStep[] = [];
