import type { TemplarNoteStyle } from '../types';
import { inspectNoteStyleSchema } from '../templates/schema';
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
  automaticOverwriteAllowed: boolean;
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
    automaticOverwriteAllowed: false,
  };
}
