import type { App, TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { frontmatterToNoteStyle, noteStyleToFrontmatter, templateToNoteStyle } from '../templates/note-format';
import { normalizePageOptions } from '../templates/schema';
import { deepEqual } from '../utils/equality';
import { clone } from '../utils/value';

interface OptimisticEntry {
  generation: number;
  style: TemplarNoteStyle | null;
}

interface FileMutationState {
  tail: Promise<void>;
  pending: number;
  optimistic: OptimisticEntry | null;
  lastCommitted: TemplarNoteStyle | null;
  awaitingSettlement: boolean;
}

/**
 * Serializes Templar's writes per file while keeping the newest requested
 * style visible during MetadataCache lag. The vault remains concurrent across
 * different files.
 */
export class FrontmatterService {
  private readonly states = new Map<string, FileMutationState>();
  private nextGeneration = 1;

  public constructor(private readonly app: App) {}

  public getStyle(file: TFile): TemplarNoteStyle | null {
    const state = this.states.get(file.path);
    if (state?.optimistic) {
      return clone(state.optimistic.style);
    }
    if (state) {
      return clone(state.lastCommitted);
    }
    return this.cachedStyle(file);
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
    const existing = this.getStyle(file);
    const style = templateToNoteStyle(template, pageOptions);
    if (existing?.attachments) style.attachments = clone(existing.attachments);
    if (appliedByRule) {
      style.provenance ??= {};
      style.provenance.appliedByRule = { ...appliedByRule };
    }
    await this.enqueueMutation(file, style, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.templar = noteStyleToFrontmatter(style);
      });
    });
  }

  public async writeStyle(file: TFile, style: TemplarNoteStyle): Promise<void> {
    const desired = clone(style);
    await this.enqueueMutation(file, desired, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.templar = noteStyleToFrontmatter(desired);
      });
    });
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
  ): Promise<void> {
    const current = this.getStyle(file);
    if (!current) {
      throw new Error('The note no longer has a Templar style.');
    }
    const desired = clone(current);
    desired.page = normalizePageOptions(pageOptions);
    await this.enqueueMutation(file, desired, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.templar = noteStyleToFrontmatter(desired);
      });
    });
  }

  public async removeStyle(file: TFile): Promise<void> {
    await this.enqueueMutation(file, null, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        delete frontmatter.templar;
      });
    });
  }

  /**
   * Settle optimistic ownership only when MetadataCache reflects the newest
   * requested value. A late cache event for an older queued write is ignored.
   */
  public settle(file: TFile): void {
    const state = this.states.get(file.path);
    if (!state) return;
    const cached = this.cachedStyle(file);
    if (state.optimistic) {
      if (deepEqual(cached, state.optimistic.style)) {
        state.lastCommitted = clone(cached);
        state.optimistic = null;
        state.awaitingSettlement = false;
      }
    } else if (state.awaitingSettlement) {
      if (deepEqual(cached, state.lastCommitted)) {
        state.awaitingSettlement = false;
      }
    } else {
      state.lastCommitted = clone(cached);
    }
    this.prune(file.path, state);
  }

  /** Move the complete mutation state; a rename must not split a pending queue. */
  public rename(oldPath: string, newPath: string): void {
    const state = this.states.get(oldPath);
    if (!state) return;
    this.states.delete(oldPath);
    const destination = this.states.get(newPath);
    if (!destination) {
      this.states.set(newPath, state);
      return;
    }
    // A destination mutation is unusual for a vault rename, but retaining the
    // newest optimistic generation is safer than allowing the old path to
    // resurrect an obsolete style.
    if (
      !destination.optimistic ||
      (state.optimistic && state.optimistic.generation > destination.optimistic.generation)
    ) {
      destination.optimistic = state.optimistic;
      destination.lastCommitted = state.lastCommitted;
      destination.awaitingSettlement = state.awaitingSettlement;
    }
    destination.pending += state.pending;
    destination.tail = destination.tail.then(() => state.tail);
    this.states.set(newPath, destination);
  }

  public forget(path: string): void {
    this.states.delete(path);
  }

  private cachedStyle(file: TFile): TemplarNoteStyle | null {
    const cache = this.app.metadataCache.getFileCache(file);
    return frontmatterToNoteStyle(cache?.frontmatter?.templar);
  }

  private stateFor(file: TFile): FileMutationState {
    const existing = this.states.get(file.path);
    if (existing) return existing;
    const state: FileMutationState = {
      tail: Promise.resolve(),
      pending: 0,
      optimistic: null,
      lastCommitted: this.cachedStyle(file),
      awaitingSettlement: false,
    };
    this.states.set(file.path, state);
    return state;
  }

  private enqueueMutation(
    file: TFile,
    desiredStyle: TemplarNoteStyle | null,
    performWrite: () => Promise<void>,
  ): Promise<void> {
    const state = this.stateFor(file);
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    state.optimistic = { generation, style: clone(desiredStyle) };
    state.pending += 1;

    const job = state.tail.then(async () => {
      try {
        await performWrite();
        state.lastCommitted = clone(desiredStyle);
        state.awaitingSettlement = true;
      } catch (error) {
        // Only the generation that is still visible may roll itself back. A
        // stale failure must never erase a newer apply/remove request.
        if (state.optimistic?.generation === generation) {
          state.optimistic = null;
        }
        throw error;
      } finally {
        state.pending -= 1;
        this.prune(file.path, state);
      }
    });
    // The queue tail always resolves, allowing later jobs to run after a
    // failed write while each caller still receives its own rejection.
    state.tail = job.then(() => undefined, () => undefined);
    return job;
  }

  private prune(path: string, state: FileMutationState): void {
    if (
      state.pending === 0 &&
      !state.optimistic &&
      !state.awaitingSettlement &&
      this.states.get(path) === state
    ) {
      this.states.delete(path);
    }
  }
}
