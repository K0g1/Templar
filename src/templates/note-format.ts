import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { clone } from '../utils/value';
import { normalizeNoteStyle, normalizeTemplate } from './schema';
import { DEFAULT_PAGE_OPTIONS } from './defaults';

export function templateToNoteStyle(
  template: TemplarTemplate,
  pageOptions: NotePageOptions = clone(DEFAULT_PAGE_OPTIONS),
): TemplarNoteStyle {
  const noteStyle = clone(template) as TemplarNoteStyle;
  delete noteStyle.builtIn;
  noteStyle.sourceTemplateId = template.id;
  noteStyle.page = clone(pageOptions);
  return noteStyle;
}

export function noteStyleToFrontmatter(style: TemplarNoteStyle): Record<string, unknown> {
  return {
    version: 1,
    'style-name': style.name,
    'template-id': style.id,
    'source-template-id': style.sourceTemplateId ?? style.id,
    metadata: clone(style.metadata),
    paper: {
      color: style.paper.color,
      pattern: style.paper.pattern,
      'pattern-color': style.paper.patternColor,
      'major-pattern-color': style.paper.majorPatternColor,
      'margin-line': style.paper.marginLine,
      'margin-color': style.paper.marginColor,
      'margin-offset': style.paper.marginOffset,
    },
    baseline: {
      enabled: style.baseline.enabled,
      mode: style.baseline.mode,
      unit: style.baseline.unit,
      'snap-images': style.baseline.snapImages,
    },
    typography: {
      'body-font': style.typography.bodyFont,
      'body-size': style.typography.bodySize,
      'body-weight': style.typography.bodyWeight,
      'text-color': style.typography.textColor,
      'muted-color': style.typography.mutedColor,
    },
    headings: clone(style.headings),
    layout: {
      'max-width': style.layout.maxWidth,
      'padding-top': style.layout.paddingTop,
      'padding-right': style.layout.paddingRight,
      'padding-bottom': style.layout.paddingBottom,
      'padding-left': style.layout.paddingLeft,
      'page-radius': style.layout.pageRadius,
      'page-shadow': style.layout.pageShadow,
    },
    images: {
      frame: style.images.frame,
      'border-width': style.images.borderWidth,
      'border-color': style.images.borderColor,
      'bottom-border-width': style.images.bottomBorderWidth,
      'corner-radius': style.images.cornerRadius,
      rotation: style.images.rotation,
      shadow: style.images.shadow,
      'max-width': style.images.maxWidth,
      'top-spacing': style.images.topSpacing,
      'bottom-spacing': style.images.bottomSpacing,
      opacity: style.images.opacity,
      sepia: style.images.sepia,
      grayscale: style.images.grayscale,
      saturation: style.images.saturation,
      contrast: style.images.contrast,
    },
    blocks: {
      'link-color': style.blocks.linkColor,
      'highlight-background': style.blocks.highlightBackground,
      'highlight-text-color': style.blocks.highlightTextColor,
      'quote-accent': style.blocks.quoteAccent,
      'quote-background': style.blocks.quoteBackground,
      'quote-text-color': style.blocks.quoteTextColor,
      'code-background': style.blocks.codeBackground,
      'code-text-color': style.blocks.codeTextColor,
      'code-font': style.blocks.codeFont,
      'code-size': style.blocks.codeSize,
      'table-border': style.blocks.tableBorder,
      'table-header-background': style.blocks.tableHeaderBackground,
      'checkbox-accent': style.blocks.checkboxAccent,
    },
    page: {
      mode: style.page.mode,
      size: style.page.size,
      width: style.page.width,
      height: style.page.height,
      gap: style.page.gap,
      'scale-to-fit': style.page.scaleToFit,
    },
    ...(style.attachments ? { attachments: clone(style.attachments) } : {}),
    css: style.css,
  };
}

export function frontmatterToNoteStyle(raw: unknown): TemplarNoteStyle | null {
  return normalizeNoteStyle(raw);
}

export function templateToExportObject(template: TemplarTemplate): Record<string, unknown> {
  const portableTemplate = noteStyleToFrontmatter(templateToNoteStyle(template));
  // Page mode is a per-note choice, not part of a reusable visual template.
  delete portableTemplate.page;
  return {
    'templar-template': portableTemplate,
  };
}

export function parsedObjectToTemplate(raw: unknown): TemplarTemplate {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return normalizeTemplate(raw);
  }
  const source = raw as Record<string, unknown>;
  const candidate = source['templar-template'] ?? source.templar ?? source;
  return normalizeTemplate(candidate);
}
