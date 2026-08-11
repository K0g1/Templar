import { TEMPLAR_STYLE_ELEMENT_CLASS } from '../../constants';

/** Owns the one generated stylesheet attached to a renderer content root. */
export class OwnedStyleHost {
  public ensure(contentEl: HTMLElement): HTMLStyleElement {
    const existing = contentEl.querySelector<HTMLStyleElement>(
      `:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`,
    );
    if (existing) return existing;
    const style = contentEl.ownerDocument.createElement('style');
    style.className = TEMPLAR_STYLE_ELEMENT_CLASS;
    style.dataset.templarOwned = 'true';
    contentEl.prepend(style);
    return style;
  }

  public clear(contentEl: HTMLElement): void {
    contentEl
      .querySelector<HTMLStyleElement>(`:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`)
      ?.remove();
  }
}
