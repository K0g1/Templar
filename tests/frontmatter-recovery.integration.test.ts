import type { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { FrontmatterService, ProtectedTemplarDataError } from '../src/services/frontmatter';
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
      protectedDataPolicy: 'allow-after-recovery',
    });
    expect((raw as Record<string, unknown>).version).toBe(1);
  });
});
