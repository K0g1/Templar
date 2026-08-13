export type SchemaDataStatus =
  | 'absent'
  | 'current'
  | 'migrated'
  | 'unsupported-future'
  | 'unsupported-legacy'
  | 'invalid'
  | 'migration-failed';

export interface MigrationTraceStep {
  id: string;
  from: number;
  to: number;
}

export interface MigrationIssue {
  code:
    | 'missing-version'
    | 'invalid-version'
    | 'unsupported-future'
    | 'unsupported-legacy'
    | 'missing-migration-step'
    | 'migration-threw'
    | 'wrong-output-version'
    | 'validation-failed';
  message: string;
}

export interface SchemaMigrationResult<T> {
  status: SchemaDataStatus;
  rawVersion: number | null;
  currentVersion: number;
  value: T | null;
  migratedRaw: Record<string, unknown> | null;
  trace: MigrationTraceStep[];
  issues: MigrationIssue[];
}

export interface MigrationStep {
  id: string;
  from: number;
  to: number;
  migrate(raw: Readonly<Record<string, unknown>>): Record<string, unknown>;
}
