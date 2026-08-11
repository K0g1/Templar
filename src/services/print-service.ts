import { MarkdownView, Platform, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { FrontmatterService } from './frontmatter';
import type { PageRenderer } from './page-renderer';
import { printPageSize } from './print-layout';

export class PrintService {
  private cleanupCurrent: (() => void) | null = null;
  private busy = false;

  public constructor(
    private readonly frontmatter: FrontmatterService,
    private readonly renderer: PageRenderer,
  ) {}

  public available(leaf: WorkspaceLeaf | null): boolean {
    const view = leaf?.view;
    const print = view?.containerEl.ownerDocument.defaultView?.print;
    return view instanceof MarkdownView && typeof print === 'function';
  }

  public async print(leaf: WorkspaceLeaf, file: TFile): Promise<void> {
    if (!(leaf.view instanceof MarkdownView) || leaf.view.file?.path !== file.path) {
      throw new Error('Open the styled note in the active Markdown pane before printing.');
    }
    const document = leaf.view.containerEl.ownerDocument;
    const window = document.defaultView;
    if (!window || typeof window.print !== 'function') {
      throw new Error('Printing is not available on this platform.');
    }
    if (this.busy) {
      throw new Error('Templar is already preparing a print job.');
    }
    this.busy = true;
    const view = leaf.view;
    const originalState = view.getState();
    const switchedMode = view.getMode() !== 'preview';
    const assertCurrent = (): void => {
      if (leaf.view !== view || view.file?.path !== file.path) {
        throw new Error('The active note changed while Templar was preparing it for print.');
      }
    };
    const restoreViewMode = (): void => {
      if (switchedMode && leaf.view === view && view.file?.path === file.path) {
        void view.setState(originalState, { history: false }).then(() =>
          this.renderer.refreshLeafNow(leaf),
        );
      }
    };

    try {
      if (switchedMode) {
        await view.setState({ ...originalState, mode: 'preview' }, { history: false });
        assertCurrent();
      }
      const style = this.renderer.resolvedStyle(leaf) ?? this.frontmatter.getStyle(file);
      if (!style) throw new Error('The active note does not have a Templar style.');
      await this.renderer.refreshLeafNow(leaf);
      assertCurrent();
      await document.fonts?.ready;
      assertCurrent();
      const images = [...view.contentEl.querySelectorAll('img')];
      await Promise.race([
        Promise.all(images.map(async (image) => {
          if ('decode' in image) await image.decode().catch(() => undefined);
        })),
        new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
      ]);
      assertCurrent();
      await waitForLayoutQuiet(view.contentEl, window);
      assertCurrent();

      const target = view.contentEl;
      const styleEl = target.querySelector<HTMLStyleElement>(':scope > style.templar-note-style');
      if (!styleEl) throw new Error('Templar could not prepare the note style for printing.');
      this.renderer.preparePrint(leaf, style);
      const marker = `templar-print-${Math.random().toString(36).slice(2)}`;
      target.dataset.templarPrintTarget = marker;
      const ancestors: HTMLElement[] = [];
      for (let ancestor = target.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
        ancestor.addClass('templar-print-ancestor');
        ancestors.push(ancestor);
      }
      document.body.addClass('templar-printing');
      const previousCss = styleEl.textContent;
      const pageSize = printPageSize(style);
      styleEl.textContent = `${previousCss}\n@page { size: ${pageSize}; margin: 0; }
@media print {
  body.templar-printing { background: white !important; }
  body.templar-printing > * { visibility: hidden !important; }
  body.templar-printing .templar-print-ancestor {
    clip: auto !important; clip-path: none !important; contain: none !important;
    overflow: visible !important; transform: none !important;
  }
  body.templar-printing [data-templar-print-target="${marker}"],
  body.templar-printing [data-templar-print-target="${marker}"] * { visibility: visible !important; }
  body.templar-printing [data-templar-print-target="${marker}"] {
    inset: 0 !important; margin: 0 !important; position: absolute !important; width: 100% !important;
  }
  body.templar-printing [data-templar-print-target="${marker}"] .templar-page {
    background: transparent !important; box-shadow: none !important; overflow: visible !important;
  }
  body.templar-printing [data-templar-print-target="${marker}"] .templar-page-content {
    --templar-page-scale: 1; print-color-adjust: exact; -webkit-print-color-adjust: exact;
  }
  body.templar-printing [data-templar-print-target="${marker}"][data-templar-mode="paged"] .templar-page-content::before {
    mask-image: none !important; -webkit-mask-image: none !important;
  }
}`;
      let fallback = 0;
      let cleaned = false;
      const cleanup = (): void => {
        if (cleaned) return;
        cleaned = true;
        if (fallback) window.clearTimeout(fallback);
        window.removeEventListener('afterprint', cleanup);
        styleEl.textContent = previousCss;
        delete target.dataset.templarPrintTarget;
        for (const ancestor of ancestors) ancestor.removeClass('templar-print-ancestor');
        document.body.removeClass('templar-printing');
        this.renderer.restoreAfterPrint(leaf, style);
        restoreViewMode();
        this.busy = false;
        if (this.cleanupCurrent === cleanup) this.cleanupCurrent = null;
      };
      this.cleanupCurrent = cleanup;
      window.addEventListener('afterprint', cleanup, { once: true });
      fallback = window.setTimeout(cleanup, Platform.isMobile ? 60_000 : 10_000);
      window.print();
      if (!Platform.isMobile) cleanup();
    } catch (error) {
      this.cleanupCurrent?.();
      if (this.busy) {
        restoreViewMode();
        this.busy = false;
      }
      throw error;
    }
  }

  public destroy(): void {
    this.cleanupCurrent?.();
  }
}

async function waitForLayoutQuiet(target: HTMLElement, window: Window): Promise<void> {
  await new Promise<void>((resolve) => {
    let quietTimer = 0;
    let maximumTimer = 0;
    let complete = false;
    const finish = (): void => {
      if (complete) return;
      complete = true;
      if (quietTimer) window.clearTimeout(quietTimer);
      if (maximumTimer) window.clearTimeout(maximumTimer);
      resizeObserver?.disconnect();
      mutationObserver.disconnect();
      resolve();
    };
    const changed = (): void => {
      if (quietTimer) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, 120);
    };
    const resizeObserver = typeof ResizeObserver === 'undefined'
      ? null
      : new ResizeObserver(changed);
    const mutationObserver = new MutationObserver(changed);
    resizeObserver?.observe(target);
    mutationObserver.observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    maximumTimer = window.setTimeout(finish, 3000);
    changed();
  });
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
  );
}
