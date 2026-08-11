import type { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { FrontmatterService } from '../src/services/frontmatter';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { noteStyleToFrontmatter, templateToNoteStyle } from '../src/templates/note-format';

function file(path: string): TFile {
  return { path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path } as TFile;
}

function fixture() {
  const note = file('Notes/lag.md');
  const cache = new Map<string, { frontmatter?: Record<string, unknown> }>();
  let persisted: Record<string, unknown> = {};
  const storage = { value: persisted };
  const app = {
    metadataCache: { getFileCache: (target: TFile) => cache.get(target.path) ?? null },
    fileManager: {
      processFrontMatter: async (target: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
        const next = { ...persisted };
        callback(next);
        persisted = next;
        storage.value = next;
      },
    },
  } as unknown as App;
  return { note, cache, service: new FrontmatterService(app), storage };
}

describe('FrontmatterService integration contract', () => {
  it('keeps the last committed style through stale metadata after a successful write', async () => {
    const harness = fixture();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[1]!);
    await harness.service.applyTemplate(harness.note, style);
    expect(harness.service.getStyle(harness.note)?.id).toBe(style.id);

    harness.cache.set(harness.note.path, { frontmatter: {} });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(style.id);

    harness.cache.set(harness.note.path, { frontmatter: { templar: noteStyleToFrontmatter(style) } });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(style.id);
  });

  it('serializes apply then remove and exposes the newest optimistic result', async () => {
    const harness = fixture();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[2]!);
    const apply = harness.service.applyTemplate(harness.note, style);
    const remove = harness.service.removeStyle(harness.note);
    expect(harness.service.getStyle(harness.note)).toBeNull();
    await apply;
    await remove;
    expect(harness.storage.value.templar).toBeUndefined();
    expect(harness.service.getStyle(harness.note)).toBeNull();
  });

  it('accepts an external cache value after a successful local write without local cache settlement', async () => {
    const harness = fixture();
    const local = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const external = templateToNoteStyle(BUILT_IN_TEMPLATES[3]!);
    await harness.service.applyTemplate(harness.note, local);

    harness.cache.set(harness.note.path, { frontmatter: { templar: noteStyleToFrontmatter(external) } });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(external.id);
  });
});
