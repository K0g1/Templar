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
    const renderer = {
      setPreview: vi.fn(async () => undefined),
      cancelPreview: vi.fn(async () => undefined),
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
});
