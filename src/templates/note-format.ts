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
      'pattern-opacity': style.paper.patternOpacity,
      'pattern-scale': style.paper.patternScale,
      'dot-radius': style.paper.dotRadius,
      'graph-major-interval': style.paper.graphMajorInterval,
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
      'body-line-height': style.typography.bodyLineHeight,
      'first-line-indent': style.typography.firstLineIndent,
      'drop-cap': style.typography.dropCap,
    },
    headings: clone(style.headings),
    lists: {
      'marker-style': style.lists.markerStyle,
      'marker-color': style.lists.markerColor,
      'indent-guides': style.lists.indentGuides,
      'indent-guide-color': style.lists.indentGuideColor,
      'nested-indent': style.lists.nestedIndent,
    },
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
      float: style.images.float,
      'object-fit': style.images.objectFit,
      duotone: style.images.duotone,
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
      'table-border-width': style.blocks.tableBorderWidth,
      'table-font-size': style.blocks.tableFontSize,
      'table-text-color': style.blocks.tableTextColor,
      'table-header-text-color': style.blocks.tableHeaderTextColor,
      'table-padding': style.blocks.tablePadding,
      'table-striped': style.blocks.tableStriped,
      'table-stripe-color': style.blocks.tableStripeColor,
      'checkbox-accent': style.blocks.checkboxAccent,
      'divider-color': style.blocks.dividerColor,
      'divider-width': style.blocks.dividerWidth,
      'divider-style': style.blocks.dividerStyle,
      'callout-accent': style.blocks.calloutAccent,
      'callout-background': style.blocks.calloutBackground,
      'callout-text-color': style.blocks.calloutTextColor,
      'callout-title-color': style.blocks.calloutTitleColor,
      'callout-icon-color': style.blocks.calloutIconColor,
      'callout-border-width': style.blocks.calloutBorderWidth,
      'callout-radius': style.blocks.calloutRadius,
      'callout-variants': clone(style.blocks.calloutVariants),
      'embed-background': style.blocks.embedBackground,
      'embed-accent': style.blocks.embedAccent,
      'embed-radius': style.blocks.embedRadius,
    },
    watermark: {
      text: style.watermark.text,
      color: style.watermark.color,
      size: style.watermark.size,
      rotation: style.watermark.rotation,
      opacity: style.watermark.opacity,
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
