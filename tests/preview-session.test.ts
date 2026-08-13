import { describe, expect, it, vi } from 'vitest';
import { PreviewSessionService } from '../src/services/preview-session';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import type { FrontmatterService } from '../src/services/frontmatter';
import type { PageRenderer } from '../src/services/page-renderer';
import type { TFile, WorkspaceLeaf } from 'obsidian';
import { clone } from '../src/utils/value';

function fixture<T>(value: Partial<T>): T {
  return value as T;
}

describe('preview sessions', () => {
  it('coalesces rapid previews, keeps them leaf-local, and restores on cancel', async () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrame = 1;
    const view = {
      requestAnimationFrame: (callback: FrameRequestCallback) => {
        const id = nextFrame++;
        callbacks.set(id, callback);
        return id;
      },
      cancelAnimationFrame: (id: number) => callbacks.delete(id),
    };
    const leaf = { view: { containerEl: { ownerDocument: { defaultView: view } } } } as unknown as WorkspaceLeaf;
    const file = fixture<TFile>({ path: 'Research/note.md' });
    const setPreview = vi.fn(async () => undefined);
    const cancelPreview = vi.fn(async () => undefined);
    const renderer = {
      setPreview,
      cancelPreview,
      cancelPreviewsByOwner: vi.fn(),
    } as unknown as PageRenderer;
    const frontmatter = { getStyle: vi.fn(() => null) } as unknown as FrontmatterService;
    const service = new PreviewSessionService(clone(DEFAULT_SETTINGS), frontmatter, renderer);

    service.preview('sidebar', leaf, file, BUILT_IN_TEMPLATES[0]!);
    service.preview('sidebar', leaf, file, BUILT_IN_TEMPLATES[1]!);
    expect(callbacks.size).toBe(1);
    const callback = [...callbacks.values()][0]!;
    callback(0);
    await Promise.resolve();
    expect(setPreview).toHaveBeenCalledTimes(1);
    expect(setPreview).toHaveBeenLastCalledWith(
      leaf,
      'sidebar',
      file.path,
      expect.objectContaining({ id: BUILT_IN_TEMPLATES[1]!.id }),
    );

    await service.cancel('sidebar');
    expect(cancelPreview).toHaveBeenCalledWith(leaf, 'sidebar');
    expect(service.current()).toBeNull();
  });

  it('cancels sessions whose leaves have closed', async () => {
    const view = { requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() };
    const leaf = { view: { containerEl: { ownerDocument: { defaultView: view } } } } as unknown as WorkspaceLeaf;
    const file = fixture<TFile>({ path: 'note.md' });
    const cancelPreview = vi.fn(async () => undefined);
    const renderer = {
      setPreview: vi.fn(async () => undefined),
      cancelPreview,
      cancelPreviewsByOwner: vi.fn(),
    } as unknown as PageRenderer;
    const service = new PreviewSessionService(
      clone(DEFAULT_SETTINGS),
      { getStyle: vi.fn(() => null) } as unknown as FrontmatterService,
      renderer,
    );
    service.preview('sidebar', leaf, file, BUILT_IN_TEMPLATES[0]!);
    await expect(service.cancelMissingLeaves(new Set())).resolves.toBe(true);
    expect(service.current()).toBeNull();
  });

  it('survives a transient file-less Markdown mode rebuild but cancels a real file change', async () => {
    const viewWindow = {
      requestAnimationFrame: vi.fn(() => 1),
      cancelAnimationFrame: vi.fn(),
    };
    const leafView: {
      containerEl: { ownerDocument: { defaultView: typeof viewWindow } };
      file: TFile | null;
      getViewType: () => string;
    } = {
      containerEl: { ownerDocument: { defaultView: viewWindow } },
      file: null,
      getViewType: () => 'markdown',
    };
    const leaf = { view: leafView } as unknown as WorkspaceLeaf;
    const file = fixture<TFile>({ path: 'Research/note.md' });
    const cancelPreview = vi.fn(async () => undefined);
    const renderer = {
      setPreview: vi.fn(async () => undefined),
      cancelPreview,
      cancelPreviewsByOwner: vi.fn(),
    } as unknown as PageRenderer;
    const service = new PreviewSessionService(
      clone(DEFAULT_SETTINGS),
      { getStyle: vi.fn(() => null) } as unknown as FrontmatterService,
      renderer,
    );
    service.preview('sidebar', leaf, file, BUILT_IN_TEMPLATES[0]!);

    await service.cancelMismatchedLeaves();
    expect(service.current('sidebar')?.file.path).toBe(file.path);

    leafView.file = fixture<TFile>({ path: 'Research/other.md' });
    await service.cancelMismatchedLeaves();
    expect(service.current()).toBeNull();
    expect(cancelPreview).toHaveBeenCalledWith(leaf, 'sidebar');
  });

  it('keeps two previews in one document independently addressable', () => {
    const ownerDocument = {} as Document;
    const view = { containerEl: { ownerDocument }, requestAnimationFrame: vi.fn(() => 1), cancelAnimationFrame: vi.fn() };
    const firstLeaf = { view } as unknown as WorkspaceLeaf;
    const secondLeaf = { view: { ...view } } as unknown as WorkspaceLeaf;
    const firstFile = fixture<TFile>({ path: 'first.md' });
    const secondFile = fixture<TFile>({ path: 'second.md' });
    const cancelPreview = vi.fn(async () => undefined);
    const renderer = {
      setPreview: vi.fn(async () => undefined),
      cancelPreview,
      cancelPreviewsByOwner: vi.fn(),
    } as unknown as PageRenderer;
    const service = new PreviewSessionService(
      clone(DEFAULT_SETTINGS),
      { getStyle: vi.fn(() => null) } as unknown as FrontmatterService,
      renderer,
    );

    service.preview('first', firstLeaf, firstFile, BUILT_IN_TEMPLATES[0]!);
    service.preview('second', secondLeaf, secondFile, BUILT_IN_TEMPLATES[1]!);
    expect(service.sessionsForDocument(ownerDocument).map((session) => session.owner)).toEqual(['first', 'second']);
    expect(service.currentForLeaf(firstLeaf)?.owner).toBe('first');
    expect(service.currentForLeaf(secondLeaf)?.owner).toBe('second');
  });

  it('retargets an owner across leaves and cancels the frame in the old window', async () => {
    const oldCallbacks = new Map<number, FrameRequestCallback>();
    const oldWindow = {
      requestAnimationFrame: (callback: FrameRequestCallback) => { oldCallbacks.set(1, callback); return 1; },
      cancelAnimationFrame: vi.fn((id: number) => oldCallbacks.delete(id)),
    };
    const newWindow = { requestAnimationFrame: vi.fn(() => 2), cancelAnimationFrame: vi.fn() };
    const oldLeaf = { view: { containerEl: { ownerDocument: { defaultView: oldWindow } } } } as unknown as WorkspaceLeaf;
    const newLeaf = { view: { containerEl: { ownerDocument: { defaultView: newWindow } } } } as unknown as WorkspaceLeaf;
    const oldFile = fixture<TFile>({ path: 'old.md' });
    const newFile = fixture<TFile>({ path: 'new.md' });
    const cancelPreview = vi.fn(async () => undefined);
    const renderer = {
      setPreview: vi.fn(async () => undefined),
      cancelPreview,
      cancelPreviewsByOwner: vi.fn(),
    } as unknown as PageRenderer;
    const service = new PreviewSessionService(
      clone(DEFAULT_SETTINGS),
      { getStyle: vi.fn(() => null) } as unknown as FrontmatterService,
      renderer,
    );
    service.preview('owner', oldLeaf, oldFile, BUILT_IN_TEMPLATES[0]!);
    service.preview('owner', newLeaf, newFile, BUILT_IN_TEMPLATES[1]!);
    expect(oldWindow.cancelAnimationFrame).toHaveBeenCalledWith(1);
    expect(cancelPreview).toHaveBeenCalledWith(oldLeaf, 'owner');
    expect(service.currentForLeaf(oldLeaf)).toBeNull();
    expect(service.currentForLeaf(newLeaf)?.file.path).toBe('new.md');
  });
});
