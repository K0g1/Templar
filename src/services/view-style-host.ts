import {
  TEMPLAR_CLASS,
  TEMPLAR_CONTENT_CLASS,
  TEMPLAR_PAGE_CLASS,
  TEMPLAR_STYLE_ELEMENT_CLASS,
} from '../constants';
import type { TemplarSettings } from '../types';

/**
 * Owns the DOM artifacts Templar injects into a Markdown view: the scoped
 * <style> element, the templar class markers, and the reading/source page
 * class application. All mutation is idempotent and reversible.
 */
export class ViewStyleHost {
  public constructor(private readonly settings: TemplarSettings) {}

  public applyScopedStyle(contentEl: HTMLElement, css: string, scopeValue: string, filePath: string): void {
    contentEl.addClass(TEMPLAR_CLASS);
    contentEl.dataset.templarScope = scopeValue;
    contentEl.dataset.templarFile = filePath;
    const styleEl = this.getOrCreateStyleElement(contentEl);
    styleEl.textContent = css;
  }

  public prepareViewRoots(contentEl: HTMLElement): void {
    this.clearPageClasses(contentEl);
    const readingRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    const sourceRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-source-view.mod-cm6',
    );
    if (this.settings.enableReadingView && readingRoot) {
      readingRoot.addClass(TEMPLAR_PAGE_CLASS);
      readingRoot
        .querySelector(':scope > .markdown-preview-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    }
    if (this.settings.enableLivePreview && sourceRoot) {
      const scroller = sourceRoot.querySelector<HTMLElement>(
        ':scope > .cm-editor > .cm-scroller',
      );
      scroller?.addClass(TEMPLAR_PAGE_CLASS);
      scroller
        ?.querySelector(':scope > .cm-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    }
  }

  /** Removes every Templar-owned artifact from the view. */
  public clearView(contentEl: HTMLElement): void {
    contentEl.removeClass(TEMPLAR_CLASS);
    delete contentEl.dataset.templarScope;
    delete contentEl.dataset.templarFile;
    contentEl
      .querySelector(`:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`)
      ?.remove();
    this.clearPageClasses(contentEl);
    for (const image of contentEl.querySelectorAll<HTMLElement>('img')) {
      image.style.removeProperty('--templar-image-snap');
    }
    for (const spacer of contentEl.querySelectorAll('.templar-blank-line-spacer')) {
      spacer.remove();
    }
  }

  public hasStyleElement(contentEl: HTMLElement): boolean {
    return contentEl.querySelector(`:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`) !== null;
  }

  private clearPageClasses(contentEl: HTMLElement): void {
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_PAGE_CLASS}`)) {
      element.removeClass(TEMPLAR_PAGE_CLASS);
    }
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_CONTENT_CLASS}`)) {
      element.removeClass(TEMPLAR_CONTENT_CLASS);
    }
  }

  private getOrCreateStyleElement(contentEl: HTMLElement): HTMLStyleElement {
    const existing = contentEl.querySelector<HTMLStyleElement>(
      `:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`,
    );
    if (existing) {
      return existing;
    }
    const element = contentEl.ownerDocument.createElement('style');
    element.className = TEMPLAR_STYLE_ELEMENT_CLASS;
    element.dataset.templarOwned = 'true';
    contentEl.prepend(element);
    return element;
  }
}
