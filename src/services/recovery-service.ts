import type { App, TFile } from 'obsidian';
import {
  CURRENT_TEMPLAR_FORMAT_VERSION,
  MAX_RECOVERY_RAW_BYTES,
  RECOVERY_FOLDER,
  RECOVERY_RECORD_VERSION,
} from '../constants';
import type { NoteStyleInspection } from './style-inspection';
import { rawTemplarFingerprint } from './style-fingerprint';
import { ensureVaultFolderTree } from '../utils/vault-folders';
import { slugify } from '../utils/value';

export type RecoveryKind = 'note-style' | 'settings' | 'template-import' | 'template-pack';
export type RecoveryReason =
  | 'migration'
  | 'unsupported-future'
  | 'unsupported-legacy'
  | 'invalid'
  | 'migration-failed'
  | 'manual-replace'
  | 'manual-remove';

export interface RecoveryRecord {
  format: 'templar-recovery';
  recoveryVersion: 1;
  kind: RecoveryKind;
  createdAt: string;
  pluginVersion: string;
  sourcePath?: string;
  sourceSchemaVersion: number | null;
  currentSupportedSchemaVersion: number;
  reason: RecoveryReason;
  raw: unknown;
}

export class RecoveryService {
  public constructor(
    private readonly app: App,
    private readonly pluginVersion: string,
  ) {}

  public async backupNoteStyle(
    file: TFile,
    inspection: NoteStyleInspection,
    reason: RecoveryReason,
  ): Promise<string> {
    if (!inspection.rawExists || inspection.raw === undefined || !inspection.fingerprint) {
      throw new Error('Templar could not create a recovery copy because the note has no recoverable raw data.');
    }
    return this.writeRecord({
      format: 'templar-recovery',
      recoveryVersion: RECOVERY_RECORD_VERSION,
      kind: 'note-style',
      createdAt: new Date().toISOString(),
      pluginVersion: this.pluginVersion,
      sourcePath: file.path,
      sourceSchemaVersion: inspection.rawVersion,
      currentSupportedSchemaVersion: CURRENT_TEMPLAR_FORMAT_VERSION,
      reason,
      raw: inspection.raw,
    }, file.basename);
  }

  public async backupSettings(
    raw: unknown,
    reason: RecoveryReason = 'migration',
  ): Promise<string> {
    if (raw === undefined || !rawTemplarFingerprint(raw)) {
      throw new Error('Templar could not create a recovery copy because the settings data is unavailable.');
    }
    return this.writeRecord({
      format: 'templar-recovery',
      recoveryVersion: RECOVERY_RECORD_VERSION,
      kind: 'settings',
      createdAt: new Date().toISOString(),
      pluginVersion: this.pluginVersion,
      sourceSchemaVersion: null,
      currentSupportedSchemaVersion: CURRENT_TEMPLAR_FORMAT_VERSION,
      reason,
      raw,
    }, 'settings');
  }

  public async backupRaw(
    kind: Exclude<RecoveryKind, 'note-style' | 'settings'>,
    raw: unknown,
    sourceName: string,
    sourceSchemaVersion: number | null,
    reason: RecoveryReason,
    currentSupportedSchemaVersion = CURRENT_TEMPLAR_FORMAT_VERSION,
  ): Promise<string> {
    return this.writeRecord({
      format: 'templar-recovery',
      recoveryVersion: RECOVERY_RECORD_VERSION,
      kind,
      createdAt: new Date().toISOString(),
      pluginVersion: this.pluginVersion,
      sourceSchemaVersion,
      currentSupportedSchemaVersion,
      reason,
      raw,
    }, sourceName);
  }

  private async writeRecord(record: RecoveryRecord, sourceName: string): Promise<string> {
    const serialized = JSON.stringify(record, null, 2);
    const bytes = new TextEncoder().encode(serialized).length;
    if (bytes > MAX_RECOVERY_RAW_BYTES) {
      throw new Error('Templar refused to replace this data because a safe recovery copy would exceed the recovery limit.');
    }
    await ensureVaultFolderTree(this.app, RECOVERY_FOLDER);
    const stem = slugify(sourceName.replace(/\.md$/i, '')) || 'templar-data';
    const timestamp = new Date(record.createdAt).toISOString().replace(/[.:]/g, '-');
    let path = `${RECOVERY_FOLDER}/${record.kind}__${stem}__${timestamp}.templar-recovery.json`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${RECOVERY_FOLDER}/${record.kind}__${stem}__${timestamp}-${String(suffix)}.templar-recovery.json`;
      suffix += 1;
    }
    await this.app.vault.create(path, serialized);
    return path;
  }
}
