export const TEMPLAR_VIEW_TYPE = 'templar-styles';
export const TEMPLAR_ICON = 'paintbrush-vertical';
export const TEMPLAR_FORMAT_VERSION = 1;
export const TEMPLAR_CLASS = 'templar-scope';
export const TEMPLAR_PAGE_CLASS = 'templar-page';
export const TEMPLAR_CONTENT_CLASS = 'templar-page-content';
export const TEMPLAR_STYLE_ELEMENT_CLASS = 'templar-note-style';
export const DEFAULT_TEMPLATE_ID = 'classic-ruled';
export const MAX_CUSTOM_CSS_BYTES = 50_000;
export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_PACK_TEMPLATES = 256;

export const VIRTUAL_SELECTORS = [
  '.page',
  '.page-content',
  '.page h1',
  '.page h2',
  '.page h3',
  '.page h4',
  '.page h5',
  '.page h6',
  '.page p',
  '.page ul',
  '.page ol',
  '.page li',
  '.page blockquote',
  '.page img',
  '.page table',
  '.page code',
  '.page pre',
  '.page hr',
  '.page a',
  '.page mark',
  '.page input[type="checkbox"]',
] as const;
