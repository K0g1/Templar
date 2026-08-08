import { TEMPLAR_FORMAT_VERSION } from '../constants';
import type {
  BaselineMode,
  HeadingLevelStyle,
  ImageFrame,
  NotePageOptions,
  TemplarNoteStyle,
  TemplarTemplate,
  PaperPattern,
  PageMode,
  PageSize,
  ValidationIssue,
  ValidationResult,
} from '../types';
import {
  booleanValue,
  enumValue,
  isRecord,
  numberValue,
  record,
  slugify,
  stringArray,
  stringValue,
  type UnknownRecord,
} from '../utils/value';
import { DEFAULT_PAGE_OPTIONS, DEFAULT_TEMPLATE } from './defaults';

const baselineModes: readonly BaselineMode[] = ['strict', 'balanced', 'free'];
const paperPatterns: readonly PaperPattern[] = ['blank', 'ruled', 'dot-grid', 'graph'];
const imageFrames: readonly ImageFrame[] = [
  'none',
  'thin',
  'photo',
  'polaroid',
  'scrapbook',
  'rounded',
  'technical',
  'dark',
  'vintage',
];
const decorations = ['none', 'underline', 'rule', 'highlight'] as const;
const pageModes: readonly PageMode[] = ['pageless', 'paged'];
const pageSizes: readonly PageSize[] = ['a4', 'letter', 'custom'];

type RequiredField = readonly [canonical: string, ...aliases: string[]];

const requiredTemplateSections: ReadonlyArray<{
  name: string;
  aliases?: string[];
  fields: RequiredField[];
}> = [
  {
    name: 'metadata',
    fields: [['author'], ['description'], ['tags']],
  },
  {
    name: 'paper',
    fields: [
      ['color'],
      ['pattern'],
      ['pattern-color', 'patternColor'],
      ['major-pattern-color', 'majorPatternColor'],
      ['margin-line', 'marginLine'],
      ['margin-color', 'marginColor'],
      ['margin-offset', 'marginOffset'],
    ],
  },
  {
    name: 'baseline',
    aliases: ['baseline-grid'],
    fields: [['enabled'], ['mode'], ['unit'], ['snap-images', 'snapImages']],
  },
  {
    name: 'typography',
    fields: [
      ['body-font', 'bodyFont'],
      ['body-size', 'bodySize'],
      ['body-weight', 'bodyWeight'],
      ['text-color', 'textColor'],
      ['muted-color', 'mutedColor'],
    ],
  },
  {
    name: 'layout',
    fields: [
      ['max-width', 'maxWidth'],
      ['padding-top', 'paddingTop'],
      ['padding-right', 'paddingRight'],
      ['padding-bottom', 'paddingBottom'],
      ['padding-left', 'paddingLeft'],
      ['page-radius', 'pageRadius'],
      ['page-shadow', 'pageShadow'],
    ],
  },
  {
    name: 'images',
    fields: [
      ['frame'],
      ['border-width', 'borderWidth'],
      ['border-color', 'borderColor'],
      ['bottom-border-width', 'bottomBorderWidth'],
      ['corner-radius', 'cornerRadius'],
      ['rotation'],
      ['shadow'],
      ['max-width', 'maxWidth'],
      ['top-spacing', 'topSpacing'],
      ['bottom-spacing', 'bottomSpacing'],
      ['opacity'],
      ['sepia'],
      ['grayscale'],
      ['saturation'],
      ['contrast'],
    ],
  },
  {
    name: 'blocks',
    fields: [
      ['link-color', 'linkColor'],
      ['quote-accent', 'quoteAccent'],
      ['quote-background', 'quoteBackground'],
      ['code-background', 'codeBackground'],
      ['table-border', 'tableBorder'],
      ['checkbox-accent', 'checkboxAccent'],
    ],
  },
];

const requiredPageFields: RequiredField[] = [
  ['mode'],
  ['size'],
  ['width'],
  ['height'],
  ['gap'],
  ['scale-to-fit', 'scaleToFit'],
];

function pick(source: UnknownRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (source[key] !== undefined) {
      return source[key];
    }
  }
  return undefined;
}

function hasAny(source: UnknownRecord, keys: readonly string[]): boolean {
  return keys.some((key) => source[key] !== undefined);
}

function sourceCandidate(raw: unknown): UnknownRecord {
  const root = record(raw);
  return record(root['templar-template'] ?? root.templar ?? root);
}

function requireFields(
  source: UnknownRecord,
  path: string,
  fields: RequiredField[],
  issues: ValidationIssue[],
): void {
  for (const field of fields) {
    if (!hasAny(source, field)) {
      issues.push({
        severity: 'error',
        path: `${path}.${field[0]}`,
        message: `The imported document is missing “${path}.${field[0]}”.`,
        fix: 'Export a complete Templar template or regenerate it from the authoring skill.',
      });
    }
  }
}

export function validateTemplateSource(
  raw: unknown,
  options: { requirePage?: boolean } = {},
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const source = sourceCandidate(raw);
  if (source.version !== TEMPLAR_FORMAT_VERSION) {
    const sourceVersion =
      typeof source.version === 'string' || typeof source.version === 'number'
        ? String(source.version)
        : 'unknown';
    issues.push({
      severity: 'error',
      path: 'version',
      message:
        source.version === undefined
          ? 'The imported document is missing “version: 1”.'
          : `This document uses unsupported Templar version ${sourceVersion}.`,
      fix: 'Use a complete Templar Template Specification v1 document.',
    });
  }
  requireFields(source, 'template', [
    ['style-name', 'name'],
    ['template-id', 'id'],
    ['css'],
  ], issues);

  for (const section of requiredTemplateSections) {
    const rawSection = pick(source, section.name, ...(section.aliases ?? []));
    if (!isRecord(rawSection)) {
      issues.push({
        severity: 'error',
        path: section.name,
        message: `The imported document is missing the “${section.name}” mapping.`,
        fix: 'Export a complete Templar template or regenerate it from the authoring skill.',
      });
      continue;
    }
    requireFields(rawSection, section.name, section.fields, issues);
  }

  const headings = source.headings;
  if (!isRecord(headings)) {
    issues.push({
      severity: 'error',
      path: 'headings',
      message: 'The imported document is missing the “headings” mapping.',
    });
  } else {
    for (const level of ['h1', 'h2', 'h3'] as const) {
      const heading = headings[level];
      if (!isRecord(heading)) {
        issues.push({
          severity: 'error',
          path: `headings.${level}`,
          message: `The imported document is missing “headings.${level}”.`,
        });
      } else {
        requireFields(
          heading,
          `headings.${level}`,
          [['font'], ['size'], ['weight'], ['color'], ['decoration']],
          issues,
        );
      }
    }
  }

  if (options.requirePage) {
    if (!isRecord(source.page)) {
      issues.push({
        severity: 'error',
        path: 'page',
        message: 'The note style is missing the “page” mapping.',
      });
    } else {
      requireFields(source.page, 'page', requiredPageFields, issues);
    }
  }
  return issues;
}

function normalizeHeading(raw: unknown, fallback: HeadingLevelStyle): HeadingLevelStyle {
  const value = record(raw);
  return {
    font: stringValue(value.font, fallback.font),
    size: numberValue(value.size, fallback.size, 8, 144),
    weight: numberValue(value.weight, fallback.weight, 100, 900),
    color: stringValue(value.color, fallback.color),
    decoration: enumValue(value.decoration, decorations, fallback.decoration),
  };
}

export function normalizeTemplate(raw: unknown): TemplarTemplate {
  const source = record(raw);
  const metadata = record(source.metadata);
  const paper = record(source.paper);
  const baseline = record(pick(source, 'baseline', 'baseline-grid'));
  const typography = record(source.typography);
  const headings = record(source.headings);
  const layout = record(source.layout);
  const images = record(source.images);
  const blocks = record(source.blocks);

  const name = stringValue(
    pick(source, 'name', 'style-name'),
    DEFAULT_TEMPLATE.name,
  ).trim();

  return {
    version: TEMPLAR_FORMAT_VERSION,
    id: slugify(
      stringValue(pick(source, 'id', 'template-id'), slugify(name || DEFAULT_TEMPLATE.name)),
    ),
    name: name || DEFAULT_TEMPLATE.name,
    metadata: {
      author: stringValue(metadata.author, DEFAULT_TEMPLATE.metadata.author),
      description: stringValue(metadata.description, DEFAULT_TEMPLATE.metadata.description),
      tags: stringArray(metadata.tags, DEFAULT_TEMPLATE.metadata.tags),
    },
    paper: {
      color: stringValue(paper.color, DEFAULT_TEMPLATE.paper.color),
      pattern: enumValue(paper.pattern, paperPatterns, DEFAULT_TEMPLATE.paper.pattern),
      patternColor: stringValue(
        pick(paper, 'patternColor', 'pattern-color'),
        DEFAULT_TEMPLATE.paper.patternColor,
      ),
      majorPatternColor: stringValue(
        pick(paper, 'majorPatternColor', 'major-pattern-color'),
        DEFAULT_TEMPLATE.paper.majorPatternColor,
      ),
      marginLine: booleanValue(
        pick(paper, 'marginLine', 'margin-line'),
        DEFAULT_TEMPLATE.paper.marginLine,
      ),
      marginColor: stringValue(
        pick(paper, 'marginColor', 'margin-color'),
        DEFAULT_TEMPLATE.paper.marginColor,
      ),
      marginOffset: numberValue(
        pick(paper, 'marginOffset', 'margin-offset'),
        DEFAULT_TEMPLATE.paper.marginOffset,
        0,
        400,
      ),
    },
    baseline: {
      enabled: booleanValue(baseline.enabled, DEFAULT_TEMPLATE.baseline.enabled),
      mode: enumValue(baseline.mode, baselineModes, DEFAULT_TEMPLATE.baseline.mode),
      unit: numberValue(baseline.unit, DEFAULT_TEMPLATE.baseline.unit, 12, 96),
      snapImages: booleanValue(
        pick(baseline, 'snapImages', 'snap-images'),
        DEFAULT_TEMPLATE.baseline.snapImages,
      ),
    },
    typography: {
      bodyFont: stringValue(
        pick(typography, 'bodyFont', 'body-font'),
        DEFAULT_TEMPLATE.typography.bodyFont,
      ),
      bodySize: numberValue(
        pick(typography, 'bodySize', 'body-size'),
        DEFAULT_TEMPLATE.typography.bodySize,
        8,
        72,
      ),
      bodyWeight: numberValue(
        pick(typography, 'bodyWeight', 'body-weight'),
        DEFAULT_TEMPLATE.typography.bodyWeight,
        100,
        900,
      ),
      textColor: stringValue(
        pick(typography, 'textColor', 'text-color'),
        DEFAULT_TEMPLATE.typography.textColor,
      ),
      mutedColor: stringValue(
        pick(typography, 'mutedColor', 'muted-color'),
        DEFAULT_TEMPLATE.typography.mutedColor,
      ),
    },
    headings: {
      h1: normalizeHeading(headings.h1, DEFAULT_TEMPLATE.headings.h1),
      h2: normalizeHeading(headings.h2, DEFAULT_TEMPLATE.headings.h2),
      h3: normalizeHeading(headings.h3, DEFAULT_TEMPLATE.headings.h3),
      h4: normalizeHeading(headings.h4, DEFAULT_TEMPLATE.headings.h4),
    },
    layout: {
      maxWidth: numberValue(
        pick(layout, 'maxWidth', 'max-width'),
        DEFAULT_TEMPLATE.layout.maxWidth,
        320,
        2400,
      ),
      paddingTop: numberValue(
        pick(layout, 'paddingTop', 'padding-top'),
        DEFAULT_TEMPLATE.layout.paddingTop,
        0,
        400,
      ),
      paddingRight: numberValue(
        pick(layout, 'paddingRight', 'padding-right'),
        DEFAULT_TEMPLATE.layout.paddingRight,
        0,
        400,
      ),
      paddingBottom: numberValue(
        pick(layout, 'paddingBottom', 'padding-bottom'),
        DEFAULT_TEMPLATE.layout.paddingBottom,
        0,
        600,
      ),
      paddingLeft: numberValue(
        pick(layout, 'paddingLeft', 'padding-left'),
        DEFAULT_TEMPLATE.layout.paddingLeft,
        0,
        400,
      ),
      pageRadius: numberValue(
        pick(layout, 'pageRadius', 'page-radius'),
        DEFAULT_TEMPLATE.layout.pageRadius,
        0,
        80,
      ),
      pageShadow: stringValue(
        pick(layout, 'pageShadow', 'page-shadow'),
        DEFAULT_TEMPLATE.layout.pageShadow,
      ),
    },
    images: {
      frame: enumValue(images.frame, imageFrames, DEFAULT_TEMPLATE.images.frame),
      borderWidth: numberValue(
        pick(images, 'borderWidth', 'border-width'),
        DEFAULT_TEMPLATE.images.borderWidth,
        0,
        60,
      ),
      borderColor: stringValue(
        pick(images, 'borderColor', 'border-color'),
        DEFAULT_TEMPLATE.images.borderColor,
      ),
      bottomBorderWidth: numberValue(
        pick(images, 'bottomBorderWidth', 'bottom-border-width'),
        DEFAULT_TEMPLATE.images.bottomBorderWidth,
        0,
        160,
      ),
      cornerRadius: numberValue(
        pick(images, 'cornerRadius', 'corner-radius'),
        DEFAULT_TEMPLATE.images.cornerRadius,
        0,
        100,
      ),
      rotation: numberValue(images.rotation, DEFAULT_TEMPLATE.images.rotation, -15, 15),
      shadow: stringValue(images.shadow, DEFAULT_TEMPLATE.images.shadow),
      maxWidth: numberValue(
        pick(images, 'maxWidth', 'max-width'),
        DEFAULT_TEMPLATE.images.maxWidth,
        10,
        100,
      ),
      topSpacing: numberValue(
        pick(images, 'topSpacing', 'top-spacing'),
        DEFAULT_TEMPLATE.images.topSpacing,
        0,
        240,
      ),
      bottomSpacing: numberValue(
        pick(images, 'bottomSpacing', 'bottom-spacing'),
        DEFAULT_TEMPLATE.images.bottomSpacing,
        0,
        240,
      ),
      opacity: numberValue(images.opacity, DEFAULT_TEMPLATE.images.opacity, 0, 1),
      sepia: numberValue(images.sepia, DEFAULT_TEMPLATE.images.sepia, 0, 1),
      grayscale: numberValue(images.grayscale, DEFAULT_TEMPLATE.images.grayscale, 0, 1),
      saturation: numberValue(images.saturation, DEFAULT_TEMPLATE.images.saturation, 0, 4),
      contrast: numberValue(images.contrast, DEFAULT_TEMPLATE.images.contrast, 0, 4),
    },
    blocks: {
      linkColor: stringValue(
        pick(blocks, 'linkColor', 'link-color'),
        DEFAULT_TEMPLATE.blocks.linkColor,
      ),
      highlightBackground: stringValue(
        pick(blocks, 'highlightBackground', 'highlight-background'),
        DEFAULT_TEMPLATE.blocks.highlightBackground,
      ),
      highlightTextColor: stringValue(
        pick(blocks, 'highlightTextColor', 'highlight-text-color'),
        DEFAULT_TEMPLATE.blocks.highlightTextColor,
      ),
      quoteAccent: stringValue(
        pick(blocks, 'quoteAccent', 'quote-accent'),
        DEFAULT_TEMPLATE.blocks.quoteAccent,
      ),
      quoteBackground: stringValue(
        pick(blocks, 'quoteBackground', 'quote-background'),
        DEFAULT_TEMPLATE.blocks.quoteBackground,
      ),
      quoteTextColor: stringValue(
        pick(blocks, 'quoteTextColor', 'quote-text-color'),
        DEFAULT_TEMPLATE.blocks.quoteTextColor,
      ),
      codeBackground: stringValue(
        pick(blocks, 'codeBackground', 'code-background'),
        DEFAULT_TEMPLATE.blocks.codeBackground,
      ),
      codeTextColor: stringValue(
        pick(blocks, 'codeTextColor', 'code-text-color'),
        DEFAULT_TEMPLATE.blocks.codeTextColor,
      ),
      codeFont: stringValue(
        pick(blocks, 'codeFont', 'code-font'),
        DEFAULT_TEMPLATE.blocks.codeFont,
      ),
      codeSize: numberValue(
        pick(blocks, 'codeSize', 'code-size'),
        DEFAULT_TEMPLATE.blocks.codeSize,
        8,
        48,
      ),
      tableBorder: stringValue(
        pick(blocks, 'tableBorder', 'table-border'),
        DEFAULT_TEMPLATE.blocks.tableBorder,
      ),
      tableHeaderBackground: stringValue(
        pick(blocks, 'tableHeaderBackground', 'table-header-background'),
        DEFAULT_TEMPLATE.blocks.tableHeaderBackground,
      ),
      checkboxAccent: stringValue(
        pick(blocks, 'checkboxAccent', 'checkbox-accent'),
        DEFAULT_TEMPLATE.blocks.checkboxAccent,
      ),
    },
    css: stringValue(source.css, ''),
    builtIn: booleanValue(pick(source, 'builtIn', 'built-in'), false),
  };
}

export function normalizeNoteStyle(raw: unknown): TemplarNoteStyle | null {
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const source = record(raw);
  const normalized = normalizeTemplate(source) as TemplarNoteStyle;
  normalized.page = normalizePageOptions(source.page);
  normalized.sourceTemplateId = stringValue(
    pick(source, 'sourceTemplateId', 'source-template-id', 'template-id'),
    normalized.id,
  );

  const rawAttachments = record(source.attachments);
  const attachments: TemplarNoteStyle['attachments'] = {};
  for (const [fileName, overrideValue] of Object.entries(rawAttachments)) {
    const override = record(overrideValue);
    attachments[fileName] = {
      frame: override.frame
        ? enumValue(override.frame, imageFrames, DEFAULT_TEMPLATE.images.frame)
        : undefined,
      rotation:
        override.rotation === undefined
          ? undefined
          : numberValue(override.rotation, 0, -15, 15),
      width:
        override.width === undefined
          ? undefined
          : numberValue(override.width, 100, 10, 2400),
    };
  }
  if (Object.keys(attachments).length > 0) {
    normalized.attachments = attachments;
  }
  return normalized;
}

export function normalizePageOptions(raw: unknown): NotePageOptions {
  const page = record(raw);
  const size = enumValue(page.size, pageSizes, DEFAULT_PAGE_OPTIONS.size);
  const preset =
    size === 'letter'
      ? { width: 816, height: 1056 }
      : size === 'a4'
        ? { width: 794, height: 1123 }
        : { width: DEFAULT_PAGE_OPTIONS.width, height: DEFAULT_PAGE_OPTIONS.height };
  return {
    mode: enumValue(page.mode, pageModes, DEFAULT_PAGE_OPTIONS.mode),
    size,
    width: numberValue(page.width, preset.width, 480, 1800),
    height: numberValue(page.height, preset.height, 640, 2400),
    gap: numberValue(page.gap, DEFAULT_PAGE_OPTIONS.gap, 8, 120),
    scaleToFit: booleanValue(
      pick(page, 'scaleToFit', 'scale-to-fit'),
      DEFAULT_PAGE_OPTIONS.scaleToFit,
    ),
  };
}

function validateColor(value: string, path: string, issues: ValidationIssue[]): void {
  if (!value.trim()) {
    issues.push({ severity: 'error', path, message: 'Choose a non-empty CSS color.' });
  }
  if (/url\s*\(|[;{}<>]/i.test(value)) {
    issues.push({
      severity: 'error',
      path,
      message: 'The color contains unsafe CSS syntax.',
      fix: 'Use a hex, RGB, HSL, OKLCH, or named color.',
    });
  }
}

function validateCssValue(value: string, path: string, issues: ValidationIssue[]): void {
  if (!value.trim() || /[;{}<>]/.test(value) || /(?:url|expression)\s*\(/i.test(value)) {
    issues.push({
      severity: 'error',
      path,
      message: `“${path}” contains an empty or unsafe CSS value.`,
      fix: 'Use one self-contained CSS value without semicolons, braces, URLs, or expressions.',
    });
  }
}

export function validateTemplate(template: TemplarTemplate): ValidationResult {
  const issues: ValidationIssue[] = [];
  if (template.version !== TEMPLAR_FORMAT_VERSION) {
    issues.push({
      severity: 'error',
      path: 'version',
      message: `This template uses version ${String(template.version)}; Templar supports version 1.`,
    });
  }
  if (!template.name.trim()) {
    issues.push({ severity: 'error', path: 'name', message: 'Give the style a name.' });
  }
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(template.id)) {
    issues.push({
      severity: 'error',
      path: 'id',
      message: 'The style ID must use lowercase letters, numbers, and single hyphens.',
      fix: `Use “${slugify(template.name)}”.`,
    });
  }
  if (template.baseline.unit < 12 || template.baseline.unit > 96) {
    issues.push({
      severity: 'error',
      path: 'baseline.unit',
      message: 'Vertical rhythm must be between 12px and 96px.',
    });
  }
  if (template.typography.bodySize > template.baseline.unit * 2 && template.baseline.mode === 'strict') {
    issues.push({
      severity: 'warning',
      path: 'typography.bodySize',
      message: 'The body font is more than twice the grid unit and may feel crowded.',
      fix: 'Increase vertical rhythm or reduce the body font size.',
    });
  }
  validateColor(template.paper.color, 'paper.color', issues);
  validateColor(template.typography.textColor, 'typography.textColor', issues);
  validateColor(template.typography.mutedColor, 'typography.mutedColor', issues);
  validateColor(template.paper.patternColor, 'paper.patternColor', issues);
  validateColor(template.paper.majorPatternColor, 'paper.majorPatternColor', issues);
  validateColor(template.paper.marginColor, 'paper.marginColor', issues);
  validateColor(template.headings.h1.color, 'headings.h1.color', issues);
  validateColor(template.headings.h2.color, 'headings.h2.color', issues);
  validateColor(template.headings.h3.color, 'headings.h3.color', issues);
  validateColor(template.headings.h4.color, 'headings.h4.color', issues);
  validateColor(template.images.borderColor, 'images.borderColor', issues);
  validateColor(template.blocks.linkColor, 'blocks.linkColor', issues);
  validateColor(template.blocks.highlightBackground, 'blocks.highlightBackground', issues);
  validateColor(template.blocks.highlightTextColor, 'blocks.highlightTextColor', issues);
  validateColor(template.blocks.quoteAccent, 'blocks.quoteAccent', issues);
  validateColor(template.blocks.quoteBackground, 'blocks.quoteBackground', issues);
  validateColor(template.blocks.quoteTextColor, 'blocks.quoteTextColor', issues);
  validateColor(template.blocks.codeBackground, 'blocks.codeBackground', issues);
  validateColor(template.blocks.codeTextColor, 'blocks.codeTextColor', issues);
  validateColor(template.blocks.tableBorder, 'blocks.tableBorder', issues);
  validateColor(
    template.blocks.tableHeaderBackground,
    'blocks.tableHeaderBackground',
    issues,
  );
  validateColor(template.blocks.checkboxAccent, 'blocks.checkboxAccent', issues);
  validateCssValue(template.typography.bodyFont, 'typography.bodyFont', issues);
  validateCssValue(template.headings.h1.font, 'headings.h1.font', issues);
  validateCssValue(template.headings.h2.font, 'headings.h2.font', issues);
  validateCssValue(template.headings.h3.font, 'headings.h3.font', issues);
  validateCssValue(template.headings.h4.font, 'headings.h4.font', issues);
  validateCssValue(template.blocks.codeFont, 'blocks.codeFont', issues);
  validateCssValue(template.layout.pageShadow, 'layout.pageShadow', issues);
  validateCssValue(template.images.shadow, 'images.shadow', issues);
  const horizontalPadding = template.layout.paddingLeft + template.layout.paddingRight;
  const verticalPadding = template.layout.paddingTop + template.layout.paddingBottom;
  const minimumReadableWidth = 240;
  const minimumReadableHeight = 240;
  if (
    template.layout.maxWidth - horizontalPadding < minimumReadableWidth ||
    480 - horizontalPadding < minimumReadableWidth
  ) {
    issues.push({
      severity: 'error',
      path: 'layout',
      message: 'Left and right padding leave too little text width on the minimum supported page.',
      fix: 'Keep their total at or below 240px and leave at least 240px inside the pageless max width.',
    });
  }
  if (640 - verticalPadding < minimumReadableHeight) {
    issues.push({
      severity: 'error',
      path: 'layout',
      message: 'Top and bottom padding leave too little printable height on the minimum supported page.',
      fix: 'Keep their total at or below 400px.',
    });
  }
  if (template.images.maxWidth > 100) {
    issues.push({
      severity: 'error',
      path: 'images.maxWidth',
      message: 'Default image width cannot exceed 100% of the page.',
    });
  }
  if (template.css.length > 50_000) {
    issues.push({
      severity: 'error',
      path: 'css',
      message: 'Custom CSS is larger than the 50 KB template limit.',
      fix: 'Remove generated repetition and external assets.',
    });
  }
  return {
    valid: !issues.some((issue) => issue.severity === 'error'),
    issues,
  };
}
