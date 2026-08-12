import type { App, TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { frontmatterToNoteStyle, noteStyleToFrontmatter, templateToNoteStyle } from '../templates/note-format';
import { normalizePageOptions } from '../templates/schema';
import { deepEqual } from '../utils/equality';
import { clone } from '../utils/value';
import { inspectRawNoteStyle, type NoteStyleInspection } from './style-inspection';
import { rawTemplarFingerprint } from './style-fingerprint';

interface OptimisticEntry {
  generation: number;
  rawFingerprint: string;
  style: TemplarNoteStyle | null;
  inspectionStatus: NoteStyleInspection['status'];
}

interface KnownLocalSnapshot {
  generation: number;
  style: TemplarNoteStyle | null;
}

interface ExternalCacheCandidate {
  observedSequence: number;
  style: TemplarNoteStyle | null;
}

interface FileMutationState {
  tail: Promise<void>;
  pending: number;
  optimistic: OptimisticEntry | null;
  lastCommitted: TemplarNoteStyle | null;
  cacheObservationSequence: number;
  latestSuccessfulWriteObservationSequence: number;
  knownLocalSnapshots: KnownLocalSnapshot[];
  externalCandidate: ExternalCacheCandidate | null;
}

const MAX_KNOWN_LOCAL_SNAPSHOTS = 8;

export interface FrontmatterWriteGuard {
  expectedRawFingerprint?: string;
  protectedDataPolicy?: 'refuse' | 'allow-after-recovery';
}

export class StaleTemplarDataError extends Error {
  public constructor() {
    super("This note's Templar data changed while this editor was open. Reload the current data before saving.");
    this.name = 'StaleTemplarDataError';
  }
}

export class ProtectedTemplarDataError extends Error {
  public constructor() {
    super('This note contains Templar data that cannot be safely interpreted. Open Templar Recovery before replacing or removing it.');
    this.name = 'ProtectedTemplarDataError';
  }
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

  public inspect(file: TFile): NoteStyleInspection {
    const state = this.states.get(file.path);
    if (state?.optimistic) {
      const raw = state.optimistic.style ? noteStyleToFrontmatter(state.optimistic.style) : undefined;
      const inspection = inspectRawNoteStyle(raw);
      return {
        ...inspection,
        fingerprint: state.optimistic.rawFingerprint,
        status: state.optimistic.inspectionStatus,
      };
    }
    return inspectRawNoteStyle(this.app.metadataCache.getFileCache(file)?.frontmatter?.templar);
  }

  public hasTemplarData(file: TFile): boolean {
    return this.inspect(file).rawExists;
  }

  public canAutoApply(file: TFile): boolean {
    return this.inspect(file).status === 'absent';
  }

  public async applyTemplate(
    file: TFile,
    template: TemplarTemplate,
    pageOptions?: NotePageOptions,
    appliedByRule?: { id: string; name: string },
    guard: FrontmatterWriteGuard = {},
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
        this.assertWriteAllowed(frontmatter.templar, guard);
        frontmatter.templar = this.serializedStyle(style, frontmatter.templar);
      });
    }, 'current');
  }

  public async writeStyle(
    file: TFile,
    style: TemplarNoteStyle,
    guard: FrontmatterWriteGuard = {},
  ): Promise<void> {
    const desired = clone(style);
    await this.enqueueMutation(file, desired, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        this.assertWriteAllowed(frontmatter.templar, guard);
        frontmatter.templar = this.serializedStyle(desired, frontmatter.templar);
      });
    }, 'current');
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
    guard: FrontmatterWriteGuard = {},
  ): Promise<void> {
    const current = this.getStyle(file);
    if (!current) {
      throw new Error('The note no longer has a Templar style.');
    }
    const desired = clone(current);
    desired.page = normalizePageOptions(pageOptions);
    await this.enqueueMutation(file, desired, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        this.assertWriteAllowed(frontmatter.templar, guard);
        const currentStyle = inspectRawNoteStyle(frontmatter.templar).style;
        if (!currentStyle) throw new Error('The note no longer has a renderable Templar style.');
        currentStyle.page = normalizePageOptions(pageOptions);
        frontmatter.templar = this.serializedStyle(currentStyle, frontmatter.templar);
      });
    }, 'current');
  }

  public async removeStyle(file: TFile, guard: FrontmatterWriteGuard = {}): Promise<void> {
    await this.enqueueMutation(file, null, async () => {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        this.assertWriteAllowed(frontmatter.templar, guard);
        delete frontmatter.templar;
      });
    }, 'absent');
  }

  /** Reconcile one MetadataCache observation with local and external ownership. */
  public settle(file: TFile): void {
    const state = this.states.get(file.path);
    if (!state) return;
    state.cacheObservationSequence += 1;
    const observedSequence = state.cacheObservationSequence;
    const cached = this.cachedStyle(file);

    if (state.optimistic && deepEqual(cached, state.optimistic.style)) {
      state.lastCommitted = clone(cached);
      state.optimistic = null;
      state.externalCandidate = null;
      state.knownLocalSnapshots = [{ generation: 0, style: clone(cached) }];
      this.prune(file.path, state);
      return;
    }

    if (state.knownLocalSnapshots.some((snapshot) => deepEqual(cached, snapshot.style))) {
      if (
        !state.optimistic &&
        state.pending === 0 &&
        deepEqual(cached, state.lastCommitted)
      ) {
        state.knownLocalSnapshots = [{ generation: 0, style: clone(cached) }];
        this.prune(file.path, state);
      }
      return;
    }

    if (state.pending > 0) {
      state.externalCandidate = {
        observedSequence,
        style: clone(cached),
      };
      return;
    }

    if (observedSequence > state.latestSuccessfulWriteObservationSequence) {
      state.lastCommitted = clone(cached);
      state.optimistic = null;
      state.externalCandidate = null;
      state.knownLocalSnapshots = [{ generation: 0, style: clone(cached) }];
    }
    this.prune(file.path, state);
  }

  /** Move the complete mutation state; a rename must not split a pending queue. */
  public rename(oldPath: string, newPath: string): void {
    const state = this.states.get(oldPath);
    if (!state) return;
    this.states.delete(oldPath);
    // A successful vault rename cannot target an existing file path. If a
    // stale destination state exists, discard it rather than merging two
    // independent mutation queues with different filesystem identities.
    this.states.delete(newPath);
    this.states.set(newPath, state);
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
    const initial = this.cachedStyle(file);
    const state: FileMutationState = {
      tail: Promise.resolve(),
      pending: 0,
      optimistic: null,
      lastCommitted: clone(initial),
      cacheObservationSequence: 0,
      latestSuccessfulWriteObservationSequence: 0,
      knownLocalSnapshots: [{ generation: 0, style: clone(initial) }],
      externalCandidate: null,
    };
    this.states.set(file.path, state);
    return state;
  }

  private enqueueMutation(
    file: TFile,
    desiredStyle: TemplarNoteStyle | null,
    performWrite: () => Promise<void>,
    inspectionStatus: NoteStyleInspection['status'],
  ): Promise<void> {
    const state = this.stateFor(file);
    const generation = this.nextGeneration;
    this.nextGeneration += 1;
    state.optimistic = {
      generation,
      rawFingerprint: rawTemplarFingerprint(desiredStyle ? noteStyleToFrontmatter(desiredStyle) : undefined),
      style: clone(desiredStyle),
      inspectionStatus,
    };
    state.pending += 1;

    const job = state.tail.then(async () => {
      try {
        await performWrite();
        state.lastCommitted = clone(desiredStyle);
        state.knownLocalSnapshots.push({ generation, style: clone(desiredStyle) });
        if (state.knownLocalSnapshots.length > MAX_KNOWN_LOCAL_SNAPSHOTS) {
          state.knownLocalSnapshots.splice(0, state.knownLocalSnapshots.length - MAX_KNOWN_LOCAL_SNAPSHOTS);
        }
        state.latestSuccessfulWriteObservationSequence = state.cacheObservationSequence;
        if (
          state.externalCandidate &&
          state.externalCandidate.observedSequence <= state.latestSuccessfulWriteObservationSequence
        ) {
          state.externalCandidate = null;
        }
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

  private assertWriteAllowed(raw: unknown, guard: FrontmatterWriteGuard): void {
    const currentFingerprint = rawTemplarFingerprint(raw);
    if (guard.expectedRawFingerprint !== undefined && guard.expectedRawFingerprint !== currentFingerprint) {
      throw new StaleTemplarDataError();
    }
    const inspection = inspectRawNoteStyle(raw);
    if (
      inspection.rawExists &&
      inspection.status !== 'current' &&
      inspection.status !== 'migrated' &&
      guard.protectedDataPolicy !== 'allow-after-recovery'
    ) {
      throw new ProtectedTemplarDataError();
    }
  }

  private serializedStyle(style: TemplarNoteStyle, currentRaw: unknown): Record<string, unknown> {
    const serialized = noteStyleToFrontmatter(style);
    const current = typeof currentRaw === 'object' && currentRaw !== null && !Array.isArray(currentRaw)
      ? currentRaw as Record<string, unknown>
      : null;
    const currentProvenance = current?.provenance;
    const desiredProvenance = serialized.provenance;
    if (
      typeof currentProvenance === 'object' && currentProvenance !== null && !Array.isArray(currentProvenance) &&
      typeof (currentProvenance as Record<string, unknown>)['source-snapshot'] === 'object' &&
      (!desiredProvenance || typeof desiredProvenance !== 'object' ||
        (desiredProvenance as Record<string, unknown>)['source-snapshot'] === undefined)
    ) {
      serialized.provenance = {
        ...(typeof desiredProvenance === 'object' && desiredProvenance !== null ? desiredProvenance : {}),
        'source-snapshot': clone((currentProvenance as Record<string, unknown>)['source-snapshot']),
      };
    }
    return serialized;
  }

  private prune(path: string, state: FileMutationState): void {
    if (
      state.pending === 0 &&
      !state.optimistic &&
      !state.externalCandidate &&
      this.states.get(path) === state
    ) {
      this.states.delete(path);
    }
  }
}
