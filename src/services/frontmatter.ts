import type { App, TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { frontmatterToNoteStyle, noteStyleToFrontmatter, templateToNoteStyle } from '../templates/note-format';
import { normalizePageOptions } from '../templates/schema';
import { clone } from '../utils/value';

interface OptimisticEntry {
  style: TemplarNoteStyle | null;
  /** FIFO of snapshots still expected from metadata events. */
  expectedSnapshots: Array<Record<string, unknown> | null>;
}

const MAX_EXPECTED_SNAPSHOTS = 8;

/**
 * Reads and writes the `templar` frontmatter property through Obsidian's
 * file manager, with a small optimistic map so the active view renders
 * immediately without re-reading the note.
 *
 * Mutation safety:
 * - Every write is serialized per file through a promise chain keyed by the
 *   `TFile` object itself (a WeakMap), so apply/remove/write operations
 *   cannot interleave inside `processFrontMatter`, and renames cannot split
 *   the chain.
 * - Queued entries are removed when their own tail settles, so the map
 *   cannot grow without bound and active chains are never bulk-cleared.
 * - `settle()` matches the metadata-cache value against the FIFO of
 *   expected write snapshots. Missing values (`undefined` from a deleted
 *   property and `null` from a removal snapshot) are treated as the same
 *   "absent" state. A cache value that matches an older expected write only
 *   drains that entry; a value matching none of the expected snapshots is
 *   treated as an external edit that supersedes optimistic state.
 * - Styles are cloned at the repository boundary so callers cannot mutate
 *   in-flight or optimistic state by editing the object they passed in.
 */
export class FrontmatterService {
  private readonly optimisticStyles = new Map<string, OptimisticEntry>();
  private readonly writeQueues = new WeakMap<TFile, Promise<unknown>>();

  public constructor(private readonly app: App) {}

  public getStyle(file: TFile): TemplarNoteStyle | null {
    const optimistic = this.optimisticStyles.get(file.path);
    if (optimistic) {
      return optimistic.style ? clone(optimistic.style) : null;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    return frontmatterToNoteStyle(cache?.frontmatter?.templar);
  }

  public hasStyle(file: TFile): boolean {
    return this.getStyle(file) !== null;
  }

  public async applyTemplate(
    file: TFile,
    template: TemplarTemplate,
    pageOptions?: NotePageOptions,
    appliedByRule?: { id: string; name: string },
  ): Promise<void> {
    await this.enqueue(file, async () => {
      const existing = this.getStyle(file);
      const style = templateToNoteStyle(template, pageOptions);
      if (existing?.attachments) style.attachments = clone(existing.attachments);
      if (appliedByRule) {
        style.provenance ??= {};
        style.provenance.appliedByRule = { ...appliedByRule };
      }
      await this.persist(file, style);
    });
  }

  public async writeStyle(file: TFile, style: TemplarNoteStyle): Promise<void> {
    // Clone at the repository boundary so the caller's object cannot be
    // mutated by a later write or by the optimistic state.
    const snapshot = clone(style);
    await this.enqueue(file, async () => {
      await this.persist(file, snapshot);
    });
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
  ): Promise<void> {
    await this.enqueue(file, async () => {
      const current = this.getStyle(file);
      if (!current) {
        throw new Error('The note no longer has a Templar style.');
      }
      current.page = normalizePageOptions(pageOptions);
      await this.persist(file, current);
    });
  }

  public async removeStyle(file: TFile): Promise<void> {
    await this.enqueue(file, async () => {
      await this.persist(file, null);
    });
  }

  public settle(file: TFile): void {
    const entry = this.optimisticStyles.get(file.path);
    if (!entry) {
      return;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    const cachedValue: unknown = cache?.frontmatter?.templar;
    const normalized = normalizeAbsent(cachedValue);

    // Drain any expected snapshot that matches the incoming cache value.
    const matchingIndex = entry.expectedSnapshots.findIndex((snapshot) =>
      deepEqualNormalized(normalizeAbsent(snapshot), normalized),
    );
    if (matchingIndex >= 0) {
      entry.expectedSnapshots.splice(0, matchingIndex + 1);
      if (entry.expectedSnapshots.length === 0) {
        this.optimisticStyles.delete(file.path);
      }
      return;
    }

    // The cache value matches no expected snapshot. This can be:
    // - a stale event for an already-drained write (cache still shows an
    //   older value); or
    // - an external edit that superseded our writes before their metadata
    //   events arrived.
    // In both cases the disk is the source of truth: drop the optimistic
    // state so the next read reflects the metadata cache. Optimistic state
    // is only a rendering optimization, and converging to disk is always
    // correct.
    this.optimisticStyles.delete(file.path);
  }

  public rename(oldPath: string, newPath: string): void {
    if (!this.optimisticStyles.has(oldPath)) {
      return;
    }
    const entry = this.optimisticStyles.get(oldPath)!;
    this.optimisticStyles.delete(oldPath);
    this.optimisticStyles.set(newPath, entry);
  }

  public forget(path: string): void {
    this.optimisticStyles.delete(path);
  }

  private async persist(file: TFile, style: TemplarNoteStyle | null): Promise<void> {
    const snapshot = style ? clone(style) : null;
    const frontmatterSnapshot = snapshot
      ? noteStyleToFrontmatter(snapshot)
      : null;
    const entry = this.optimisticStyles.get(file.path) ?? {
      style: null,
      expectedSnapshots: [],
    };
    entry.style = snapshot;
    entry.expectedSnapshots.push(frontmatterSnapshot);
    if (entry.expectedSnapshots.length > MAX_EXPECTED_SNAPSHOTS) {
      entry.expectedSnapshots.splice(0, entry.expectedSnapshots.length - MAX_EXPECTED_SNAPSHOTS);
    }
    this.optimisticStyles.set(file.path, entry);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (snapshot) {
          frontmatter.templar = noteStyleToFrontmatter(snapshot);
        } else {
          delete frontmatter.templar;
        }
      });
    } catch (error) {
      // Only drop the optimistic entry if it still belongs to this write.
      const current = this.optimisticStyles.get(file.path);
      if (current && current.style === snapshot) {
        this.optimisticStyles.delete(file.path);
      }
      throw error;
    }
  }

  /**
   * Serializes writes to the same `TFile` (keyed by object identity so a
   * rename cannot split the chain). The returned promise resolves only
   * after the previous queued write for that file has settled, so
   * `processFrontMatter` callbacks never interleave for one note.
   */
  private enqueue(file: TFile, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(file) ?? Promise.resolve();
    const next = previous.then(operation);
    // Keep the chain alive even when the operation rejects so later writes
    // are not blocked forever by an earlier failure.
    const tail = next.catch(() => undefined);
    this.writeQueues.set(file, tail);
    // Remove the settled tail from the WeakMap so the queue cannot grow
    // without bound; the identity check guarantees we never delete a newer
    // chain that replaced this tail.
    void tail.then(() => {
      if (this.writeQueues.get(file) === tail) {
        this.writeQueues.delete(file);
      }
    });
    return next;
  }
}

/**
 * Treats `undefined` (property absent from metadata cache) and `null` (our
 * removal snapshot) as the same "absent" representation so removal settles.
 */
function normalizeAbsent(value: unknown): unknown {
  return value === undefined ? null : value;
}

/**
 * Normalized deep equality for metadata-cache frontmatter values. Obsidian's
 * YAML parser may produce slightly different key ordering or omit undefined
 * values, so compare structurally with plain objects and arrays.
 */
function deepEqualNormalized(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((value, index) => deepEqualNormalized(value, right[index]));
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every((key) =>
    deepEqualNormalized(leftRecord[key], rightRecord[key]),
  );
}
