import type {
  MigrationIssue,
  MigrationStep,
  SchemaMigrationResult,
} from './types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneRecord(value: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function issue(code: MigrationIssue['code'], message: string): MigrationIssue {
  return { code, message };
}

function result<T>(
  status: SchemaMigrationResult<T>['status'],
  rawVersion: number | null,
  currentVersion: number,
  issues: MigrationIssue[] = [],
  trace: SchemaMigrationResult<T>['trace'] = [],
  value: T | null = null,
  migratedRaw: Record<string, unknown> | null = null,
): SchemaMigrationResult<T> {
  return { status, rawVersion, currentVersion, value, migratedRaw, trace, issues };
}

function validVersion(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value > 0;
}

function validateSteps(steps: readonly MigrationStep[]): MigrationIssue | null {
  const ids = new Set<string>();
  const fromVersions = new Set<number>();
  for (const step of steps) {
    if (!step.id || ids.has(step.id)) {
      return issue('wrong-output-version', `Migration steps must have unique non-empty IDs; “${step.id}” is duplicated.`);
    }
    if (!Number.isInteger(step.from) || !Number.isInteger(step.to) || step.to !== step.from + 1) {
      return issue('wrong-output-version', `Migration step “${step.id}” must advance exactly one version.`);
    }
    if (fromVersions.has(step.from)) {
      return issue('missing-migration-step', `Migration steps contain more than one step from version ${String(step.from)}.`);
    }
    ids.add(step.id);
    fromVersions.add(step.from);
  }
  return null;
}

export function migrateVersionedRecord<T>(
  raw: unknown,
  options: {
    currentVersion: number;
    minimumSupportedVersion: number;
    steps: readonly MigrationStep[];
    normalizeCurrent: (raw: unknown) => T;
  },
): SchemaMigrationResult<T> {
  const stepIssue = validateSteps(options.steps);
  if (stepIssue) return result<T>('migration-failed', null, options.currentVersion, [stepIssue]);
  if (!isRecord(raw)) {
    return result<T>('invalid', null, options.currentVersion, [
      issue('invalid-version', 'Versioned Templar data must be a mapping.'),
    ]);
  }
  const rawVersion = raw.version;
  if (rawVersion === undefined) {
    return result<T>('invalid', null, options.currentVersion, [
      issue('missing-version', 'Versioned Templar data is missing its integer version.'),
    ]);
  }
  if (!validVersion(rawVersion)) {
    return result('invalid', null, options.currentVersion, [
      issue('invalid-version', 'Versioned Templar data must use a positive integer version.'),
    ]);
  }
  if (rawVersion > options.currentVersion) {
    return result<T>('unsupported-future', rawVersion, options.currentVersion, [
      issue('unsupported-future', `Templar data uses newer version ${String(rawVersion)}.`),
    ]);
  }
  if (rawVersion < options.minimumSupportedVersion) {
    return result<T>('unsupported-legacy', rawVersion, options.currentVersion, [
      issue('unsupported-legacy', `Templar data uses unsupported legacy version ${String(rawVersion)}.`),
    ]);
  }

  let intermediate = cloneRecord(raw);
  const trace: SchemaMigrationResult<T>['trace'] = [];
  if (rawVersion < options.currentVersion) {
    let version = rawVersion;
    while (version < options.currentVersion) {
      const step = options.steps.find((candidate) => candidate.from === version);
      if (!step) {
        return result<T>('migration-failed', rawVersion, options.currentVersion, [
          issue('missing-migration-step', `No migration step exists from version ${String(version)}.`),
        ], trace, null, intermediate);
      }
      try {
        const output = step.migrate(cloneRecord(intermediate));
        if (!isRecord(output) || output.version !== step.to) {
          return result<T>('migration-failed', rawVersion, options.currentVersion, [
            issue('wrong-output-version', `Migration step “${step.id}” did not return version ${String(step.to)}.`),
          ], trace, null, intermediate);
        }
        intermediate = cloneRecord(output);
      } catch (error) {
        return result<T>('migration-failed', rawVersion, options.currentVersion, [
          issue('migration-threw', `Migration step “${step.id}” failed: ${error instanceof Error ? error.message : String(error)}`),
        ], trace, null, intermediate);
      }
      trace.push({ id: step.id, from: step.from, to: step.to });
      version = step.to;
    }
  }

  try {
    const value = options.normalizeCurrent(intermediate);
    return result<T>(
      rawVersion === options.currentVersion ? 'current' : 'migrated',
      rawVersion,
      options.currentVersion,
      [],
      trace,
      value,
      rawVersion === options.currentVersion ? null : intermediate,
    );
  } catch (error) {
    return result<T>('invalid', rawVersion, options.currentVersion, [
      issue('validation-failed', `Current-version normalization failed: ${error instanceof Error ? error.message : String(error)}`),
    ], trace, null, rawVersion === options.currentVersion ? null : intermediate);
  }
}
