import type { App, TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { FrontmatterService } from '../src/services/frontmatter';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import type { TemplarNoteStyle } from '../src/types';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function file(path: string): TFile {
  return { path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path } as TFile;
}

function setup(initial: TemplarNoteStyle | null = null): {
  service: FrontmatterService;
  note: TFile;
  cache: Map<string, { frontmatter?: { templar?: unknown } }>;
  writes: Array<{ gate: Deferred<void>; file: TFile }>;
} {
  const note = file('Notes/test.md');
  const cache = new Map<string, { frontmatter?: { templar?: unknown } }>();
  if (initial) cache.set(note.path, { frontmatter: { templar: initial } });
  const writes: Array<{ gate: Deferred<void>; file: TFile }> = [];
  const app = {
    metadataCache: {
      getFileCache: (target: TFile) => cache.get(target.path) ?? null,
    },
    fileManager: {
      processFrontMatter: async (target: TFile, callback: (frontmatter: Record<string, unknown>) => void) => {
        const frontmatter: Record<string, unknown> = {
          ...(cache.get(target.path)?.frontmatter ?? {}),
        };
        callback(frontmatter);
        const gate = deferred<void>();
        writes.push({ gate, file: target });
        await gate.promise;
        cache.set(target.path, { frontmatter });
      },
    },
  } as unknown as App;
  return { service: new FrontmatterService(app), note, cache, writes };
}

function style(templateIndex: number): TemplarNoteStyle {
  return templateToNoteStyle(BUILT_IN_TEMPLATES[templateIndex]!);
}

describe('FrontmatterService mutation coordination', () => {
  it('keeps a newer optimistic request after an older write fails', async () => {
    const harness = setup();
    const a = style(0);
    const b = style(1);
    const first = harness.service.applyTemplate(harness.note, a);
    const second = harness.service.applyTemplate(harness.note, b);
    await Promise.resolve();
    expect(harness.writes).toHaveLength(1);
    expect(harness.service.getStyle(harness.note)?.id).toBe(b.id);

    harness.writes[0]!.gate.reject(new Error('A failed'));
    await expect(first).rejects.toThrow('A failed');
    await Promise.resolve();
    expect(harness.writes).toHaveLength(2);
    expect(harness.service.getStyle(harness.note)?.id).toBe(b.id);
    harness.writes[1]!.gate.resolve();
    await expect(second).resolves.toBeUndefined();
  });

  it('does not let metadata for an older write clear a newer request', async () => {
    const harness = setup();
    const a = style(0);
    const b = style(1);
    const first = harness.service.applyTemplate(harness.note, a);
    const second = harness.service.applyTemplate(harness.note, b);
    await Promise.resolve();
    harness.writes[0]!.gate.resolve();
    await first;
    await Promise.resolve();
    harness.cache.set(harness.note.path, { frontmatter: { templar: a } });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(b.id);

    harness.writes[1]!.gate.resolve();
    await second;
    harness.cache.set(harness.note.path, { frontmatter: { templar: b } });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(b.id);
  });

  it('rolls back to the last committed style when the latest write fails', async () => {
    const initial = style(0);
    const harness = setup(initial);
    const first = style(1);
    const second = style(2);
    const apply = harness.service.applyTemplate(harness.note, first);
    await Promise.resolve();
    harness.writes[0]!.gate.resolve();
    await apply;
    harness.cache.set(harness.note.path, { frontmatter: { templar: first } });
    harness.service.settle(harness.note);

    const failing = harness.service.applyTemplate(harness.note, second);
    await Promise.resolve();
    harness.writes[1]!.gate.reject(new Error('B failed'));
    await expect(failing).rejects.toThrow('B failed');
    expect(harness.service.getStyle(harness.note)?.id).toBe(first.id);
  });

  it('allows writes for different files to proceed concurrently', async () => {
    const harness = setup();
    const other = file('Notes/other.md');
    const first = harness.service.applyTemplate(harness.note, style(0));
    const second = harness.service.applyTemplate(other, style(1));
    await Promise.resolve();
    expect(harness.writes.map((entry) => entry.file.path)).toEqual(['Notes/test.md', 'Notes/other.md']);
    harness.writes[0]!.gate.resolve();
    harness.writes[1]!.gate.resolve();
    await expect(first).resolves.toBeUndefined();
    await expect(second).resolves.toBeUndefined();
  });

  it('moves pending optimistic state across a rename', async () => {
    const harness = setup();
    const oldFile = harness.note;
    const renamed = file('Notes/renamed.md');
    const pending = harness.service.applyTemplate(oldFile, style(0));
    await Promise.resolve();
    oldFile.path = renamed.path;
    harness.service.rename('Notes/test.md', renamed.path);
    expect(harness.service.getStyle(renamed)?.id).toBe(style(0).id);
    harness.writes[0]!.gate.resolve();
    await pending;
    expect(harness.service.getStyle(renamed)?.id).toBe(style(0).id);
  });

  it('ignores an unrelated metadata event while a write is pending', async () => {
    const initial = style(0);
    const harness = setup(initial);
    const next = style(1);
    const pending = harness.service.applyTemplate(harness.note, next);
    await Promise.resolve();
    harness.cache.set(harness.note.path, { frontmatter: { templar: initial } });
    harness.service.settle(harness.note);
    expect(harness.service.getStyle(harness.note)?.id).toBe(next.id);
    harness.writes[0]!.gate.resolve();
    await pending;
  });
});
