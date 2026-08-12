export const TEMPLAR_VIEW_TYPE = 'templar-styles';
export const TEMPLAR_ICON = 'paintbrush-vertical';
export const CURRENT_TEMPLAR_FORMAT_VERSION = 1 as const;
export const MIN_SUPPORTED_TEMPLAR_FORMAT_VERSION = 1 as const;
export const CURRENT_PACK_FORMAT_VERSION = 1 as const;
export const MIN_SUPPORTED_PACK_FORMAT_VERSION = 1 as const;
export const CURRENT_SETTINGS_DATA_VERSION = 1 as const;
export const RECOVERY_RECORD_VERSION = 1 as const;
export const RECOVERY_FOLDER = 'Templar Recovery';
export const MAX_RECOVERY_RAW_BYTES = 8_000_000;
export const TEMPLAR_FORMAT_VERSION = CURRENT_TEMPLAR_FORMAT_VERSION;
export const TEMPLAR_CLASS = 'templar-scope';
export const TEMPLAR_PAGE_CLASS = 'templar-page';
export const TEMPLAR_CONTENT_CLASS = 'templar-page-content';
export const TEMPLAR_STYLE_ELEMENT_CLASS = 'templar-note-style';
export const DEFAULT_TEMPLATE_ID = 'classic-ruled';
export const MAX_CUSTOM_CSS_BYTES = 50_000;
export const MAX_IMPORT_BYTES = 8_000_000;
export const MAX_PACK_TEMPLATES = 256;
export const MAX_CALLOUT_VARIANTS = 64;
export const MAX_ATTACHMENT_OVERRIDES = 512;
export const MAX_ATTACHMENT_FILENAME_BYTES = 512;
export const MAX_TEMPLATE_TAGS = 64;
export const MAX_TAG_LENGTH = 80;
export const MAX_STYLE_RULES = 128;
export const MAX_RULE_CONDITIONS = 32;
export const MAX_NORMALIZED_NOTE_STYLE_BYTES = 512 * 1024;
export const MAX_GENERATED_STYLE_BYTES = 1024 * 1024;

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
