import { MarkdownView, Notice, Platform, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { FrontmatterService } from './frontmatter';
import type { PageRenderer } from './page-renderer';
import { printPageSize } from './print-layout';
import { waitForLayoutQuiet } from './print-layout-quiet';

export { waitForLayoutQuiet } from './print-layout-quiet';

export class PrintService {
  private cleanupCurrent: (() => void) | null = null;
  private restoration: Promise<void> | null = null;
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
    const restoreViewMode = async (): Promise<void> => {
      if (switchedMode && leaf.view === view && view.file?.path === file.path) {
        await view.setState(originalState, { history: false });
        if (leaf.view === view && view.file?.path === file.path) {
          await this.renderer.refreshLeafNow(leaf);
        }
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
        this.beginRestoration(restoreViewMode);
        if (this.cleanupCurrent === cleanup) this.cleanupCurrent = null;
      };
      this.cleanupCurrent = cleanup;
      window.addEventListener('afterprint', cleanup, { once: true });
      fallback = window.setTimeout(cleanup, Platform.isMobile ? 60_000 : 10_000);
      window.print();
      if (!Platform.isMobile) cleanup();
    } catch (error) {
      this.cleanupCurrent?.();
      if (this.busy && !this.restoration) {
        this.beginRestoration(restoreViewMode);
      }
      throw error;
    }
  }

  public destroy(): void {
    this.cleanupCurrent?.();
  }

  private beginRestoration(restore: () => Promise<void>): void {
    if (this.restoration) return;
    const restoration = Promise.resolve().then(restore);
    this.restoration = restoration;
    void restoration.then(
      () => this.releaseAfterRestoration(restoration),
      (error: unknown) => {
        new Notice(`Templar could not restore the note after printing: ${errorMessage(error)}`);
        this.releaseAfterRestoration(restoration);
      },
    );
  }

  private releaseAfterRestoration(restoration: Promise<void>): void {
    if (this.restoration !== restoration) return;
    this.restoration = null;
    this.busy = false;
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
