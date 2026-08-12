import type { TemplarNoteStyle } from '../types';
import { inspectNoteStyleSchema, inspectTemplateSchema } from '../templates/schema';
import { rawTemplarFingerprint } from './style-fingerprint';
import type { MigrationIssue, MigrationTraceStep, SchemaDataStatus } from '../migrations/types';

export interface NoteStyleInspection {
  status: SchemaDataStatus;
  rawExists: boolean;
  raw: unknown;
  rawVersion: number | null;
  style: TemplarNoteStyle | null;
  fingerprint: string;
  trace: MigrationTraceStep[];
  issues: readonly MigrationIssue[];
  protectedPaths: readonly ProtectedSchemaPath[];
  automaticOverwriteAllowed: boolean;
}

export interface ProtectedSchemaPath {
  path: 'provenance.source-snapshot';
  status: Exclude<SchemaDataStatus, 'absent' | 'current' | 'migrated'>;
  rawVersion: number | null;
  raw: unknown;
  issues: readonly MigrationIssue[];
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function protectedPaths(raw: unknown): ProtectedSchemaPath[] {
  const provenance = record(record(raw)?.provenance);
  const snapshot = provenance?.['source-snapshot'] ?? provenance?.sourceSnapshot;
  if (snapshot === undefined) return [];
  const result = inspectTemplateSchema(snapshot);
  if (result.status === 'absent' || result.status === 'current' || result.status === 'migrated') return [];
  return [{
    path: 'provenance.source-snapshot',
    status: result.status,
    rawVersion: result.rawVersion,
    raw: snapshot,
    issues: result.issues,
  }];
}

export function inspectRawNoteStyle(raw: unknown): NoteStyleInspection {
  const rawExists = raw !== undefined;
  if (!rawExists) {
    return {
      status: 'absent',
      rawExists: false,
      raw,
      rawVersion: null,
      style: null,
      fingerprint: rawTemplarFingerprint(raw),
      trace: [],
      issues: [],
      protectedPaths: [],
      automaticOverwriteAllowed: true,
    };
  }
  const result = inspectNoteStyleSchema(raw);
  return {
    status: result.status,
    rawExists: true,
    raw,
    rawVersion: result.rawVersion,
    style: result.value,
    fingerprint: rawTemplarFingerprint(raw),
    trace: result.trace,
    issues: result.issues,
    protectedPaths: protectedPaths(raw),
    automaticOverwriteAllowed: false,
  };
}
