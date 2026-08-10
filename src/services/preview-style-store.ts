import type { WorkspaceLeaf } from 'obsidian';
import type { TemplarNoteStyle } from '../types';
import { clone } from '../utils/value';

export interface PreviewState {
  owner: string;
  filePath: string;
  style: TemplarNoteStyle;
}

/**
 * Stores per-leaf preview sessions (try-on drafts) separately from the
 * renderer. Preview state is leaf-local and must never leak into persisted
 * note styles; this store guarantees previews are always clones of the
 * underlying style.
 */
export class PreviewStyleStore {
  private readonly previews = new Map<WorkspaceLeaf, PreviewState>();

  public set(leaf: WorkspaceLeaf, state: PreviewState): void {
    this.previews.set(leaf, { ...state, style: clone(state.style) });
  }

  public get(leaf: WorkspaceLeaf): PreviewState | null {
    const state = this.previews.get(leaf);
    return state ? { ...state, style: clone(state.style) } : null;
  }

  public delete(leaf: WorkspaceLeaf): boolean {
    return this.previews.delete(leaf);
  }

  public clear(): void {
    this.previews.clear();
  }

  public has(leaf: WorkspaceLeaf): boolean {
    return this.previews.has(leaf);
  }

  /**
   * Yields cloned preview states so callers cannot mutate the store through
   * iteration (same guarantee as {@link get}).
   */
  public clonedEntries(): Array<[WorkspaceLeaf, PreviewState]> {
    return [...this.previews.entries()].map(([leaf, state]) => [
      leaf,
      { ...state, style: clone(state.style) },
    ]);
  }

  public deleteByOwner(owner: string): WorkspaceLeaf[] {
    const removed: WorkspaceLeaf[] = [];
    for (const [leaf, state] of this.previews) {
      if (state.owner === owner) {
        this.previews.delete(leaf);
        removed.push(leaf);
      }
    }
    return removed;
  }
}
