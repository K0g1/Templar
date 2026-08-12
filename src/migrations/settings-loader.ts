import { CURRENT_SETTINGS_DATA_VERSION } from '../constants';
import { normalizeSettingsWithIssues, type QuarantinedTemplate } from '../templates/settings';
import { clone } from '../utils/value';
import { SETTINGS_MIGRATIONS } from './settings-migrations';
import type { MigrationTraceStep } from './types';

export interface SettingsLoadResult {
  settings: ReturnType<typeof normalizeSettingsWithIssues>['settings'];
  issues: QuarantinedTemplate[];
  status: 'current' | 'migrated' | 'unsupported-future' | 'invalid' | 'migration-failed';
  raw: unknown;
  rawVersion: number | null;
  migrationTrace: MigrationTraceStep[];
  protectedRaw?: unknown;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function loadVersionedSettings(raw: unknown): SettingsLoadResult {
  const source = record(raw);
  if (!source) {
    return {
      settings: normalizeSettingsWithIssues({}).settings,
      issues: [],
      status: 'invalid',
      raw,
      rawVersion: null,
      migrationTrace: [],
    };
  }
  const rawVersionValue = source['settings-data-version'];
  if (rawVersionValue === undefined) {
    const step = SETTINGS_MIGRATIONS[0]!;
    const migrated = step.migrate({ ...source, version: 0 });
    const normalized = normalizeSettingsWithIssues(migrated);
    return {
      settings: normalized.settings,
      issues: normalized.issues,
      status: 'migrated',
      raw,
      rawVersion: null,
      migrationTrace: [{ id: step.id, from: step.from, to: step.to }],
    };
  }
  if (typeof rawVersionValue !== 'number' || !Number.isInteger(rawVersionValue) || rawVersionValue <= 0) {
    return {
      settings: normalizeSettingsWithIssues({}).settings,
      issues: [],
      status: 'invalid',
      raw,
      rawVersion: null,
      migrationTrace: [],
      protectedRaw: raw,
    };
  }
  if (rawVersionValue > CURRENT_SETTINGS_DATA_VERSION) {
    return {
      settings: normalizeSettingsWithIssues({}).settings,
      issues: [],
      status: 'unsupported-future',
      raw,
      rawVersion: rawVersionValue,
      migrationTrace: [],
      protectedRaw: clone(raw),
    };
  }
  if (rawVersionValue < CURRENT_SETTINGS_DATA_VERSION) {
    return {
      settings: normalizeSettingsWithIssues({}).settings,
      issues: [],
      status: 'migration-failed',
      raw,
      rawVersion: rawVersionValue,
      migrationTrace: [],
      protectedRaw: clone(raw),
    };
  }
  const normalized = normalizeSettingsWithIssues(source);
  return {
    settings: normalized.settings,
    issues: normalized.issues,
    status: 'current',
    raw,
    rawVersion: rawVersionValue,
    migrationTrace: [],
  };
}
