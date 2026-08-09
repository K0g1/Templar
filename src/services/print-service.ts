import { MarkdownView, Platform, type TFile, type WorkspaceLeaf } from 'obsidian';
import type { FrontmatterService } from './frontmatter';
import type { PageRenderer } from './page-renderer';
import { printPageSize } from './print-layout';

export class PrintService {
  private cleanupCurrent: (() => void) | null = null;

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
    const style = this.frontmatter.getStyle(file);
    if (!style) throw new Error('The active note does not have a Templar style.');
    const document = leaf.view.containerEl.ownerDocument;
    const window = document.defaultView;
    if (!window || typeof window.print !== 'function') {
      throw new Error('Printing is not available on this platform.');
    }
    this.cleanupCurrent?.();
    await this.renderer.refreshLeafNow(leaf);
    await document.fonts?.ready;
    const images = [...leaf.view.contentEl.querySelectorAll('img')];
    await Promise.race([
      Promise.all(images.map(async (image) => {
        if ('decode' in image) await image.decode().catch(() => undefined);
      })),
      new Promise<void>((resolve) => window.setTimeout(resolve, 2500)),
    ]);
    await new Promise<void>((resolve) => window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())));

    const target = leaf.view.contentEl;
    const styleEl = target.querySelector<HTMLStyleElement>(':scope > style.templar-note-style');
    if (!styleEl) throw new Error('Templar could not prepare the note style for printing.');
    this.renderer.preparePrint(leaf, style);
    const marker = `templar-print-${Math.random().toString(36).slice(2)}`;
    target.dataset.templarPrintTarget = marker;
    document.body.addClass('templar-printing');
    const previousCss = styleEl.textContent;
    const pageSize = printPageSize(style);
    styleEl.textContent = `${previousCss}\n@page { size: ${pageSize}; margin: 0; }
@media print {
  body.templar-printing { background: white !important; }
  body.templar-printing > * { visibility: hidden !important; }
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
    const cleanup = (): void => {
      if (fallback) window.clearTimeout(fallback);
      window.removeEventListener('afterprint', cleanup);
      styleEl.textContent = previousCss;
      delete target.dataset.templarPrintTarget;
      document.body.removeClass('templar-printing');
      this.renderer.restoreAfterPrint(leaf, style);
      if (this.cleanupCurrent === cleanup) this.cleanupCurrent = null;
    };
    this.cleanupCurrent = cleanup;
    window.addEventListener('afterprint', cleanup, { once: true });
    fallback = window.setTimeout(cleanup, Platform.isMobile ? 60_000 : 10_000);
    try {
      window.print();
      if (!Platform.isMobile) cleanup();
    } catch (error) {
      cleanup();
      throw error;
    }
  }

  public destroy(): void {
    this.cleanupCurrent?.();
  }
}
