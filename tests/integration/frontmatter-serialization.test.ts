import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FrontmatterService } from '../../src/services/frontmatter';
import { BUILT_IN_TEMPLATES } from '../../src/templates/builtins';
import { templateToNoteStyle } from '../../src/templates/note-format';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function makeFile() {
  return {
    path: 'notes/a.md',
    basename: 'a',
    parent: { path: 'notes' },
    extension: 'md',
  } as never;
}

function makeService() {
  const processCalls: Array<(fm: Record<string, unknown>) => void> = [];
  const gate = deferred<void>();
  const app = {
    metadataCache: {
      getFileCache: vi.fn().mockReturnValue(null),
    },
    fileManager: {
      processFrontMatter: vi.fn((_file: unknown, cb: (fm: Record<string, unknown>) => void) => {
        processCalls.push(cb);
        return gate.promise;
      }),
    },
  };
  const service = new FrontmatterService(app as never);
  return { service, app, processCalls, gate };
}

beforeEach(() => {
  vi.resetModules();
});

describe('FrontmatterService mutation serialization', () => {
  it('serializes concurrent writes to the same file', async () => {
    const { service, processCalls, gate } = makeService();
    const file = makeFile();
    const styleA = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    styleA.name = 'Style A';
    const styleB = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    styleB.name = 'Style B';

    const writeA = service.writeStyle(file, styleA);
    const writeB = service.writeStyle(file, styleB);

    // Let the first queued operation start; it must be the only one in
    // flight because the second is queued behind it.
    await Promise.resolve();
    await Promise.resolve();
    expect(processCalls.length).toBe(1);
    gate.resolve();
    await writeA;
    await writeB;
    expect(processCalls.length).toBe(2);
  });

  it('optimistic state reflects the latest write and clones at the boundary', async () => {
    const { service, processCalls, gate } = makeService();
    const file = makeFile();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.width = 800;

    const write = service.writeStyle(file, style);
    // Mutate the caller's object after submitting; the optimistic entry must
    // not be affected (cloned at the boundary).
    style.page.width = 999;
    gate.resolve();
    await write;

    const stored = service.getStyle(file);
    expect(stored?.page.width).toBe(800);
    // The mutation serialized to frontmatter used the snapshot, not the
    // caller's mutated object.
    const frontmatter: Record<string, unknown> = {};
    processCalls[0]!(frontmatter);
    expect((frontmatter.templar as { page?: { width?: number } })?.page?.width).toBe(800);
  });

  it('applyTemplate preserves attachments from the existing style', async () => {
    const { service, processCalls, gate } = makeService();
    const file = makeFile();
    // Seed an existing style with attachments via metadata cache.
    const existing = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    existing.attachments = { hero: { frame: 'photo' } };
        (service as unknown as { app: typeof service['app'] }).app.metadataCache.getFileCache = vi.fn().mockReturnValue({
      frontmatter: {
        templar: {
          id: existing.id,
          name: existing.name,
          page: existing.page,
          attachments: { hero: { frame: 'photo' } },
        },
      },
    });

    const apply = service.applyTemplate(file, BUILT_IN_TEMPLATES[1]!);
    gate.resolve();
    await apply;

    const frontmatter: Record<string, unknown> = {};
    processCalls[0]!(frontmatter);
    const stored = frontmatter.templar as { attachments?: unknown };
    expect(stored.attachments).toEqual({ hero: { frame: 'photo' } });
  });

  it('removeStyle deletes the templar property', async () => {
    const { service, processCalls, gate } = makeService();
    const file = makeFile();
    const remove = service.removeStyle(file);
    gate.resolve();
    await remove;

    const frontmatter: Record<string, unknown> = { templar: { id: 'x' } };
    processCalls[0]!(frontmatter);
    expect(frontmatter.templar).toBeUndefined();
    expect(service.hasStyle(file)).toBe(false);
  });

  it('a failing write does not block later writes', async () => {
    const { service, processCalls } = makeService();
    const file = makeFile();
    const failGate = deferred<void>();
    processCalls[0] = () => undefined; // first call already consumed
    // Replace the fileManager gate behavior: first write fails, second succeeds.
    let callIndex = 0;
    const appAccess = service as unknown as {
      app: { fileManager: { processFrontMatter: ReturnType<typeof vi.fn> } };
    };
    appAccess.app.fileManager.processFrontMatter = vi.fn(
      (_f: unknown, cb: (fm: Record<string, unknown>) => void) => {
        const index = callIndex;
        callIndex += 1;
        if (index === 0) {
          return Promise.reject(new Error('disk error'));
        }
        return Promise.resolve().then(() => {
          cb({});
        });
      },
    );

    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    await expect(service.writeStyle(file, style)).rejects.toThrow('disk error');
    // The second write still runs.
    await expect(service.writeStyle(file, style)).resolves.toBeUndefined();
    void failGate;
  });
});

describe('FrontmatterService settle semantics', () => {
  it('settle clears optimistic removal when cache value is absent', async () => {
    const { service, processCalls, gate } = makeService();
    const file = makeFile();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const write = service.writeStyle(file, style);
    gate.resolve();
    await write;

    const remove = service.removeStyle(file);
    // First write settled; second gate resolves removal.
    gate.resolve();
    await remove;

    // Simulate the metadata event after removal: templar is absent.
    (service as unknown as { app: { metadataCache: { getFileCache: ReturnType<typeof vi.fn> } } }).app.metadataCache.getFileCache = vi.fn().mockReturnValue({
      frontmatter: {},
    });
    service.settle(file);
    // Optimistic state must be cleared (no stale shadowing).
    expect(service.hasStyle(file)).toBe(false);
    void processCalls;
  });

  it('settle clears optimistic style when cache matches snapshot', async () => {
    const { service, gate } = makeService();
    const file = makeFile();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.name = 'Snapshot Match';
    const write = service.writeStyle(file, style);
    gate.resolve();
    await write;

    // Metadata cache now reflects the exact written snapshot.
    const snapshot = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    snapshot.name = 'Snapshot Match';
    const { noteStyleToFrontmatter } = await import('../../src/templates/note-format');
    (service as unknown as { app: { metadataCache: { getFileCache: ReturnType<typeof vi.fn> } } }).app.metadataCache.getFileCache = vi.fn().mockReturnValue({
      frontmatter: { templar: noteStyleToFrontmatter(snapshot) },
    });
    service.settle(file);
    expect(service.hasStyle(file)).toBe(true); // falls through to cache
    const cached = service.getStyle(file);
    expect(cached?.name).toBe('Snapshot Match');
  });
});

describe('FrontmatterService external edit handling', () => {
  it('settle surfaces unmatched external edits over optimistic state', async () => {
    const { service, gate } = makeService();
    const file = makeFile();
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.name = 'Internal Write';
    const write = service.writeStyle(file, style);
    gate.resolve();
    await write;

    // An external edit changes the note to a style we never wrote.
    const external = templateToNoteStyle(BUILT_IN_TEMPLATES[1]!);
    external.name = 'External Edit';
    const { noteStyleToFrontmatter } = await import('../../src/templates/note-format');
    (service as unknown as { app: { metadataCache: { getFileCache: ReturnType<typeof vi.fn> } } }).app.metadataCache.getFileCache = vi.fn().mockReturnValue({
      frontmatter: { templar: noteStyleToFrontmatter(external) },
    });
    service.settle(file);
    const surfaced = service.getStyle(file);
    expect(surfaced?.name).toBe('External Edit');
  });
});
