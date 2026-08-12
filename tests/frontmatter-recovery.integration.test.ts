import type { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import {
  authorizeRecoveryWrite,
  FrontmatterService,
  ProtectedNestedTemplarDataError,
  ProtectedTemplarDataError,
} from '../src/services/frontmatter';
import { rawTemplarFingerprint } from '../src/services/style-fingerprint';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';

function testFile<T>(path: string): T {
  return { path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path } as T;
}

describe('protected frontmatter recovery integration', () => {
  it('preserves a future raw value until an explicitly guarded replacement', async () => {
    const note = testFile<TFile>('Notes/future.md');
    let raw: unknown = { version: 2, futureField: 'keep-me' };
    const app = {
      metadataCache: { getFileCache: () => ({ frontmatter: { templar: raw } }) },
      fileManager: {
        processFrontMatter: async (_file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
          const next: Record<string, unknown> = { templar: raw };
          callback(next);
          raw = next.templar;
        },
      },
    } as unknown as App;
    const service = new FrontmatterService(app);
    const inspection = service.inspect(note);
    expect(inspection.status).toBe('unsupported-future');
    await expect(service.removeStyle(note)).rejects.toBeInstanceOf(ProtectedTemplarDataError);
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    await service.writeStyle(note, style, {
      expectedRawFingerprint: rawTemplarFingerprint(raw),
      recoveryAuthorization: authorizeRecoveryWrite('Templar Recovery/future.json', rawTemplarFingerprint(raw)),
    });
    expect((raw as Record<string, unknown>).version).toBe(1);
  });

  it('preserves protected nested source snapshots for page-only writes and blocks destructive replacements', async () => {
    const note = testFile<TFile>('Notes/nested-future.md');
    const original = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const raw = {
      ...original,
      provenance: { 'source-snapshot': { version: 2, futureField: 'keep-me' } },
    };
    let stored: unknown = raw;
    const app = {
      metadataCache: { getFileCache: () => ({ frontmatter: { templar: stored } }) },
      fileManager: {
        processFrontMatter: async (_file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
          const next: Record<string, unknown> = { templar: stored };
          callback(next);
          stored = next.templar;
        },
      },
    } as unknown as App;
    const service = new FrontmatterService(app);
    await service.patchPageOptions(note, { ...original.page, mode: 'paged' });
    expect(((stored as Record<string, unknown>).provenance as Record<string, unknown>)['source-snapshot']).toEqual({
      version: 2,
      futureField: 'keep-me',
    });
    await expect(service.applyTemplate(note, BUILT_IN_TEMPLATES[1]!)).rejects.toBeInstanceOf(ProtectedNestedTemplarDataError);
    await expect(service.removeStyle(note)).rejects.toBeInstanceOf(ProtectedNestedTemplarDataError);
  });

  it('permits only a fingerprint-guarded recovery replacement for a protected source snapshot', async () => {
    const note = testFile<TFile>('Notes/nested-recovery.md');
    const original = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    let stored: unknown = {
      ...original,
      provenance: { 'source-snapshot': { version: 2, futureField: 'keep-me' } },
    };
    const app = {
      metadataCache: { getFileCache: () => ({ frontmatter: { templar: stored } }) },
      fileManager: {
        processFrontMatter: async (_file: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
          const next: Record<string, unknown> = { templar: stored };
          callback(next);
          stored = next.templar;
        },
      },
    } as unknown as App;
    const service = new FrontmatterService(app);
    const inspection = service.inspect(note);

    await service.applyTemplate(note, BUILT_IN_TEMPLATES[1]!, undefined, undefined, {
      expectedRawFingerprint: inspection.fingerprint,
      recoveryAuthorization: authorizeRecoveryWrite('Templar Recovery/nested.json', inspection.fingerprint),
    });
    expect((stored as Record<string, unknown>)['source-template-id']).toBe(BUILT_IN_TEMPLATES[1]!.id);

    const staleInspection = service.inspect(note);
    stored = { ...(stored as Record<string, unknown>), changedOutsideRecovery: true };
    await expect(service.removeStyle(note, {
      expectedRawFingerprint: staleInspection.fingerprint,
      recoveryAuthorization: authorizeRecoveryWrite('Templar Recovery/stale.json', staleInspection.fingerprint),
    })).rejects.toMatchObject({ name: 'StaleTemplarDataError' });
  });
});
