import type { App, TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { frontmatterToNoteStyle, noteStyleToFrontmatter, templateToNoteStyle } from '../templates/note-format';
import { normalizePageOptions } from '../templates/schema';
import { clone } from '../utils/value';

/**
 * Reads and writes the `templar` frontmatter property through Obsidian's
 * file manager, with a small optimistic map so the active view renders
 * immediately without re-reading the note.
 *
 * Mutation safety:
 * - Every write is serialized per file path through a promise chain, so
 *   apply/remove/write operations cannot interleave inside
 *   `processFrontMatter`.
 * - Optimistic entries carry the write revision that produced them.
 *   `settle()` only clears an entry when the metadata event refers to the
 *   same revision, so a late event from write A cannot delete write B's
 *   optimistic state.
 * - Styles are cloned at the repository boundary so callers cannot mutate
 *   in-flight or optimistic state by editing the object they passed in.
 */
export class FrontmatterService {
  private readonly optimisticStyles = new Map<string, { style: TemplarNoteStyle | null; revision: number }>();
  private readonly writeQueues = new Map<string, Promise<unknown>>();
  private revision = 0;

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
    // Only settle the entry written by the same revision the metadata event
    // reflects. The revision recorded at persist time is compared against
    // the current global revision: a late event from an older write must not
    // delete a newer optimistic state. In practice Obsidian settles metadata
    // after the write completes, so matching the stored revision is enough.
    if (entry && entry.revision === this.revision) {
      this.optimisticStyles.delete(file.path);
    }
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
    this.revision += 1;
    const writeRevision = this.revision;
    this.optimisticStyles.set(file.path, {
      style: style ? clone(style) : null,
      revision: writeRevision,
    });
    try {
      const snapshot = style ? clone(style) : null;
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        if (snapshot) {
          frontmatter.templar = noteStyleToFrontmatter(snapshot);
        } else {
          delete frontmatter.templar;
        }
      });
    } catch (error) {
      const current = this.optimisticStyles.get(file.path);
      if (current && current.revision === writeRevision) {
        this.optimisticStyles.delete(file.path);
      }
      throw error;
    }
  }

  /**
   * Serializes writes to the same file: the returned promise resolves only
   * after the previous queued write for that path has settled, so
   * `processFrontMatter` callbacks never interleave for one note.
   */
  private enqueue(file: TFile, operation: () => Promise<void>): Promise<void> {
    const previous = this.writeQueues.get(file.path) ?? Promise.resolve();
    const next = previous.then(operation);
    // Keep the chain alive even when the operation rejects so later writes
    // are not blocked forever by an earlier failure.
    this.writeQueues.set(file.path, next.catch(() => undefined));
    if (this.writeQueues.size > 500) {
      // Bound memory: drop settled entries for paths that are no longer
      // being written (best-effort cleanup).
      this.writeQueues.clear();
    }
    return next;
  }
}
