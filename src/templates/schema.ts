import {
  MAX_ATTACHMENT_FILENAME_BYTES,
  MAX_ATTACHMENT_OVERRIDES,
  MAX_CALLOUT_VARIANTS,
  MAX_NORMALIZED_NOTE_STYLE_BYTES,
  MAX_TAG_LENGTH,
  MAX_TEMPLATE_TAGS,
  TEMPLAR_FORMAT_VERSION,
  CURRENT_TEMPLAR_FORMAT_VERSION,
  MIN_SUPPORTED_TEMPLAR_FORMAT_VERSION,
} from '../constants';
import { migrateVersionedRecord } from '../migrations/engine';
import { NOTE_STYLE_MIGRATIONS, TEMPLATE_MIGRATIONS } from '../migrations/format-migrations';
import type { SchemaMigrationResult } from '../migrations/types';
import type {
  BaselineMode,
  CalloutVariant,
  DividerStyle,
  HeadingLevelStyle,
  ImageFloat,
  ImageFrame,
  ImageObjectFit,
  ListMarkerStyle,
  NotePageOptions,
  TemplarNoteStyle,
  TemplarTemplate,
  PaperPattern,
  PageMode,
  PageSize,
  ValidationIssue,
  ValidationResult,
  HeadingTextTransform,
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
const paperPatterns: readonly PaperPattern[] = [
  'blank',
  'ruled',
  'dot-grid',
  'graph',
  'ledger',
  'cross-hatch',
  'diagonal',
  'hex',
  'scallop',
];
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
const imageFloats: readonly ImageFloat[] = ['none', 'left', 'right'];
const imageObjectFits: readonly ImageObjectFit[] = ['contain', 'cover', 'fill', 'scale-down'];
const dividerStyles: readonly DividerStyle[] = ['solid', 'dashed', 'dotted', 'double', 'fade'];
const listMarkerStyles: readonly ListMarkerStyle[] = ['disc', 'circle', 'square', 'none'];
const textTransforms: readonly HeadingTextTransform[] = [
  'none',
  'uppercase',
  'lowercase',
  'capitalize',
];
const decorations = ['none', 'underline', 'rule', 'highlight'] as const;
const pageModes: readonly PageMode[] = ['pageless', 'paged'];
const pageSizes: readonly PageSize[] = ['a4', 'letter', 'custom'];
const UNFILED_FOLDER = 'Unfiled';

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

  const sourceBlocks = record(source.blocks);
  const rawCalloutVariants = pick(sourceBlocks, 'calloutVariants', 'callout-variants');
  if (isRecord(rawCalloutVariants) && Object.keys(rawCalloutVariants).length > MAX_CALLOUT_VARIANTS) {
    issues.push({
      severity: 'error',
      path: 'blocks.calloutVariants',
      message: `A template may define at most ${String(MAX_CALLOUT_VARIANTS)} callout variants.`,
      fix: 'Remove unused callout variants before saving the template.',
    });
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
    letterSpacing: numberValue(value.letterSpacing, fallback.letterSpacing, 0, 10),
    textTransform: enumValue(value.textTransform, textTransforms, fallback.textTransform),
  };
}

function normalizeCalloutVariants(raw: unknown): Record<string, CalloutVariant> {
  const source = record(raw);
  const variants: Record<string, CalloutVariant> = {};
  for (const [type, variantValue] of Object.entries(source)) {
    if (Object.keys(variants).length >= MAX_CALLOUT_VARIANTS) {
      break;
    }
    if (!/^[a-z0-9-]+$/i.test(type)) {
      continue;
    }
    const normalizedType = type.toLowerCase();
    if (Object.prototype.hasOwnProperty.call(variants, normalizedType)) {
      continue;
    }
    const variant = record(variantValue);
    const normalized: CalloutVariant = {};
    if (typeof variant.accent === 'string') {
      normalized.accent = variant.accent;
    }
    if (typeof variant.background === 'string') {
      normalized.background = variant.background;
    }
    if (typeof variant.textColor === 'string') {
      normalized.textColor = variant.textColor;
    }
    if (typeof variant.titleColor === 'string') {
      normalized.titleColor = variant.titleColor;
    }
    if (typeof variant.iconColor === 'string') {
      normalized.iconColor = variant.iconColor;
    }
    variants[normalizedType] = normalized;
  }
  return variants;
}

/**
 * Normalize a display-only template folder name. Folder metadata never maps to
 * the vault filesystem, so separators and filesystem-reserved characters are
 * flattened instead of being interpreted as real paths.
 */
export function normalizeTemplateFolder(raw: unknown): string {
  if (typeof raw !== 'string') {
    return UNFILED_FOLDER;
  }
  const folder = Array.from(raw.replace(/[\\/]+/g, ' '))
    .map((character) => {
      const code = character.charCodeAt(0);
      return code <= 31 || code === 127 || '<>:"|?*'.includes(character)
        ? ' '
        : character;
    })
    .join('')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
  return folder === '.' || folder === '..' ? UNFILED_FOLDER : folder || UNFILED_FOLDER;
}

export function templateFolderKey(raw: unknown): string {
  return normalizeTemplateFolder(raw).toLowerCase();
}

function normalizeTemplateTags(raw: unknown): string[] {
  const tags = stringArray(raw, [])
    .map((tag) => tag.trim().slice(0, MAX_TAG_LENGTH))
    .filter(Boolean);
  return [...new Set(tags)].slice(0, MAX_TEMPLATE_TAGS);
}

export function normalizeTemplate(raw: unknown): TemplarTemplate {
  const source = record(raw);
  if (source.version !== undefined && source.version !== TEMPLAR_FORMAT_VERSION) {
    const version = typeof source.version === 'string' || typeof source.version === 'number'
      ? String(source.version)
      : 'unknown';
    throw new Error(`Unsupported Templar template version ${version}.`);
  }
  const metadata = record(source.metadata);
  const paper = record(source.paper);
  const baseline = record(pick(source, 'baseline', 'baseline-grid'));
  const typography = record(source.typography);
  const headings = record(source.headings);
  const lists = record(source.lists);
  const layout = record(source.layout);
  const images = record(source.images);
  const blocks = record(source.blocks);
  const watermark = record(source.watermark);

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
      folder: normalizeTemplateFolder(metadata.folder),
      tags: normalizeTemplateTags(metadata.tags ?? DEFAULT_TEMPLATE.metadata.tags),
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
      patternOpacity: numberValue(
        pick(paper, 'patternOpacity', 'pattern-opacity'),
        DEFAULT_TEMPLATE.paper.patternOpacity,
        0,
        1,
      ),
      patternScale: numberValue(
        pick(paper, 'patternScale', 'pattern-scale'),
        DEFAULT_TEMPLATE.paper.patternScale,
        0.25,
        4,
      ),
      dotRadius: numberValue(
        pick(paper, 'dotRadius', 'dot-radius'),
        DEFAULT_TEMPLATE.paper.dotRadius,
        0.5,
        6,
      ),
      graphMajorInterval: numberValue(
        pick(paper, 'graphMajorInterval', 'graph-major-interval'),
        DEFAULT_TEMPLATE.paper.graphMajorInterval,
        2,
        10,
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
      bodyLineHeight: (() => {
        const raw = pick(typography, 'bodyLineHeight', 'body-line-height');
        return raw === 0 ? 0 : numberValue(raw, 0, 16, 120);
      })(),
      firstLineIndent: numberValue(
        pick(typography, 'firstLineIndent', 'first-line-indent'),
        DEFAULT_TEMPLATE.typography.firstLineIndent,
        0,
        120,
      ),
      dropCap: booleanValue(
        pick(typography, 'dropCap', 'drop-cap'),
        DEFAULT_TEMPLATE.typography.dropCap,
      ),
    },
    headings: {
      h1: normalizeHeading(headings.h1, DEFAULT_TEMPLATE.headings.h1),
      h2: normalizeHeading(headings.h2, DEFAULT_TEMPLATE.headings.h2),
      h3: normalizeHeading(headings.h3, DEFAULT_TEMPLATE.headings.h3),
      h4: normalizeHeading(headings.h4, DEFAULT_TEMPLATE.headings.h4),
      h5: normalizeHeading(headings.h5, DEFAULT_TEMPLATE.headings.h5),
      h6: normalizeHeading(headings.h6, DEFAULT_TEMPLATE.headings.h6),
    },
    lists: {
      markerStyle: enumValue(
        pick(lists, 'markerStyle', 'marker-style'),
        listMarkerStyles,
        DEFAULT_TEMPLATE.lists.markerStyle,
      ),
      markerColor: stringValue(
        pick(lists, 'markerColor', 'marker-color'),
        DEFAULT_TEMPLATE.lists.markerColor,
      ),
      indentGuides: booleanValue(
        pick(lists, 'indentGuides', 'indent-guides'),
        DEFAULT_TEMPLATE.lists.indentGuides,
      ),
      indentGuideColor: stringValue(
        pick(lists, 'indentGuideColor', 'indent-guide-color'),
        DEFAULT_TEMPLATE.lists.indentGuideColor,
      ),
      nestedIndent: numberValue(
        pick(lists, 'nestedIndent', 'nested-indent'),
        DEFAULT_TEMPLATE.lists.nestedIndent,
        0,
        120,
      ),
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
      float: enumValue(images.float, imageFloats, DEFAULT_TEMPLATE.images.float),
      objectFit: enumValue(
        pick(images, 'objectFit', 'object-fit'),
        imageObjectFits,
        DEFAULT_TEMPLATE.images.objectFit,
      ),
      duotone: stringValue(images.duotone, DEFAULT_TEMPLATE.images.duotone),
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
      tableBorderWidth: numberValue(
        pick(blocks, 'tableBorderWidth', 'table-border-width'),
        DEFAULT_TEMPLATE.blocks.tableBorderWidth,
        0,
        12,
      ),
      tableFontSize: numberValue(
        pick(blocks, 'tableFontSize', 'table-font-size'),
        DEFAULT_TEMPLATE.blocks.tableFontSize,
        8,
        48,
      ),
      tableTextColor: stringValue(
        pick(blocks, 'tableTextColor', 'table-text-color'),
        DEFAULT_TEMPLATE.blocks.tableTextColor,
      ),
      tableHeaderTextColor: stringValue(
        pick(blocks, 'tableHeaderTextColor', 'table-header-text-color'),
        DEFAULT_TEMPLATE.blocks.tableHeaderTextColor,
      ),
      tablePadding: numberValue(
        pick(blocks, 'tablePadding', 'table-padding'),
        DEFAULT_TEMPLATE.blocks.tablePadding,
        0,
        40,
      ),
      tableStriped: booleanValue(
        pick(blocks, 'tableStriped', 'table-striped'),
        DEFAULT_TEMPLATE.blocks.tableStriped,
      ),
      tableStripeColor: stringValue(
        pick(blocks, 'tableStripeColor', 'table-stripe-color'),
        DEFAULT_TEMPLATE.blocks.tableStripeColor,
      ),
      checkboxAccent: stringValue(
        pick(blocks, 'checkboxAccent', 'checkbox-accent'),
        DEFAULT_TEMPLATE.blocks.checkboxAccent,
      ),
      dividerColor: stringValue(
        pick(blocks, 'dividerColor', 'divider-color'),
        DEFAULT_TEMPLATE.blocks.dividerColor,
      ),
      dividerWidth: numberValue(
        pick(blocks, 'dividerWidth', 'divider-width'),
        DEFAULT_TEMPLATE.blocks.dividerWidth,
        1,
        20,
      ),
      dividerStyle: enumValue(
        pick(blocks, 'dividerStyle', 'divider-style'),
        dividerStyles,
        DEFAULT_TEMPLATE.blocks.dividerStyle,
      ),
      calloutAccent: stringValue(
        pick(blocks, 'calloutAccent', 'callout-accent'),
        DEFAULT_TEMPLATE.blocks.calloutAccent,
      ),
      calloutBackground: stringValue(
        pick(blocks, 'calloutBackground', 'callout-background'),
        DEFAULT_TEMPLATE.blocks.calloutBackground,
      ),
      calloutTextColor: stringValue(
        pick(blocks, 'calloutTextColor', 'callout-text-color'),
        DEFAULT_TEMPLATE.blocks.calloutTextColor,
      ),
      calloutTitleColor: stringValue(
        pick(blocks, 'calloutTitleColor', 'callout-title-color'),
        DEFAULT_TEMPLATE.blocks.calloutTitleColor,
      ),
      calloutIconColor: stringValue(
        pick(blocks, 'calloutIconColor', 'callout-icon-color'),
        DEFAULT_TEMPLATE.blocks.calloutIconColor,
      ),
      calloutBorderWidth: numberValue(
        pick(blocks, 'calloutBorderWidth', 'callout-border-width'),
        DEFAULT_TEMPLATE.blocks.calloutBorderWidth,
        0,
        12,
      ),
      calloutRadius: numberValue(
        pick(blocks, 'calloutRadius', 'callout-radius'),
        DEFAULT_TEMPLATE.blocks.calloutRadius,
        0,
        60,
      ),
      calloutVariants: normalizeCalloutVariants(
        pick(blocks, 'calloutVariants', 'callout-variants'),
      ),
      embedBackground: stringValue(
        pick(blocks, 'embedBackground', 'embed-background'),
        DEFAULT_TEMPLATE.blocks.embedBackground,
      ),
      embedAccent: stringValue(
        pick(blocks, 'embedAccent', 'embed-accent'),
        DEFAULT_TEMPLATE.blocks.embedAccent,
      ),
      embedRadius: numberValue(
        pick(blocks, 'embedRadius', 'embed-radius'),
        DEFAULT_TEMPLATE.blocks.embedRadius,
        0,
        60,
      ),
    },
    watermark: {
      text: stringValue(watermark.text, DEFAULT_TEMPLATE.watermark.text),
      color: stringValue(watermark.color, DEFAULT_TEMPLATE.watermark.color),
      size: numberValue(watermark.size, DEFAULT_TEMPLATE.watermark.size, 24, 240),
      rotation: numberValue(watermark.rotation, DEFAULT_TEMPLATE.watermark.rotation, -45, 45),
      opacity: numberValue(watermark.opacity, DEFAULT_TEMPLATE.watermark.opacity, 0.05, 1),
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
  if (source.version !== TEMPLAR_FORMAT_VERSION) {
    return null;
  }
  const normalized = normalizeTemplate(source) as TemplarNoteStyle;
  normalized.page = normalizePageOptions(source.page);
  normalized.sourceTemplateId = stringValue(
    pick(source, 'sourceTemplateId', 'source-template-id', 'template-id'),
    normalized.id,
  );

  const provenance = record(source.provenance);
  const sourceSnapshotValue = pick(provenance, 'sourceSnapshot', 'source-snapshot');
  const appliedByRule = record(pick(provenance, 'appliedByRule', 'applied-by-rule'));
  if (
    sourceSnapshotValue &&
    typeof sourceSnapshotValue === 'object' &&
    record(sourceSnapshotValue).version === TEMPLAR_FORMAT_VERSION
  ) {
    const sourceSnapshot = normalizeTemplate(sourceSnapshotValue);
    delete sourceSnapshot.builtIn;
    normalized.provenance = { sourceSnapshot };
  }
  const ruleId = stringValue(appliedByRule.id, '').trim();
  if (ruleId) {
    normalized.provenance ??= {};
    normalized.provenance.appliedByRule = {
      id: ruleId,
      name: stringValue(appliedByRule.name, ruleId),
    };
  }

  if (source.attachments !== undefined && !isRecord(source.attachments)) {
    return null;
  }
  const rawAttachments = record(source.attachments);
  const attachmentEntries = Object.entries(rawAttachments);
  if (attachmentEntries.length > MAX_ATTACHMENT_OVERRIDES) {
    return null;
  }
  const attachments: TemplarNoteStyle['attachments'] = {};
  for (const [fileName, overrideValue] of attachmentEntries) {
    if (new TextEncoder().encode(fileName).length > MAX_ATTACHMENT_FILENAME_BYTES) {
      return null;
    }
    const override = record(overrideValue);
    const normalizedOverride = {
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
    if (
      normalizedOverride.frame !== undefined ||
      normalizedOverride.rotation !== undefined ||
      normalizedOverride.width !== undefined
    ) {
      attachments[fileName] = normalizedOverride;
    }
  }
  if (Object.keys(attachments).length > 0) {
    normalized.attachments = attachments;
  }
  if (new TextEncoder().encode(JSON.stringify(normalized)).length > MAX_NORMALIZED_NOTE_STYLE_BYTES) {
    return null;
  }
  return validateTemplate(normalized).valid ? normalized : null;
}

export function normalizeCurrentTemplateV1(raw: unknown): TemplarTemplate {
  const source = sourceCandidate(raw);
  if (source.version !== CURRENT_TEMPLAR_FORMAT_VERSION) {
    throw new Error(`Expected current Templar template version ${String(CURRENT_TEMPLAR_FORMAT_VERSION)}.`);
  }
  return normalizeTemplate(source);
}

export function normalizeCurrentNoteStyleV1(raw: unknown): TemplarNoteStyle {
  const source = record(raw);
  if (source.version !== CURRENT_TEMPLAR_FORMAT_VERSION) {
    throw new Error(`Expected current Templar note style version ${String(CURRENT_TEMPLAR_FORMAT_VERSION)}.`);
  }
  const style = normalizeNoteStyle(source);
  if (!style) throw new Error('The current Templar note style is invalid.');
  return style;
}

export function inspectTemplateSchema(raw: unknown): SchemaMigrationResult<TemplarTemplate> {
  const source = sourceCandidate(raw);
  return migrateVersionedRecord(source, {
    currentVersion: CURRENT_TEMPLAR_FORMAT_VERSION,
    minimumSupportedVersion: MIN_SUPPORTED_TEMPLAR_FORMAT_VERSION,
    steps: TEMPLATE_MIGRATIONS,
    normalizeCurrent: normalizeCurrentTemplateV1,
  });
}

export function inspectNoteStyleSchema(raw: unknown): SchemaMigrationResult<TemplarNoteStyle> {
  const result = migrateVersionedRecord(raw, {
    currentVersion: CURRENT_TEMPLAR_FORMAT_VERSION,
    minimumSupportedVersion: MIN_SUPPORTED_TEMPLAR_FORMAT_VERSION,
    steps: NOTE_STYLE_MIGRATIONS,
    normalizeCurrent: normalizeCurrentNoteStyleV1,
  });
  if (result.value) {
    const source = record(raw);
    const provenance = record(source.provenance);
    const snapshot = pick(provenance, 'sourceSnapshot', 'source-snapshot');
    if (snapshot !== undefined) {
      const snapshotResult = inspectTemplateSchema(snapshot);
      if (snapshotResult.value) {
        result.value.provenance ??= {};
        result.value.provenance.sourceSnapshot = snapshotResult.value;
      } else {
        result.issues.push(...snapshotResult.issues.map((entry) => ({
          ...entry,
          message: `provenance.source-snapshot: ${entry.message}`,
        })));
      }
    }
  }
  return result;
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
    width: size === 'custom'
      ? numberValue(page.width, preset.width, 480, 1800)
      : preset.width,
    height: size === 'custom'
      ? numberValue(page.height, preset.height, 640, 2400)
      : preset.height,
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
  if (/(?:url|var|env|attr)\s*\(|[;{}<>]/i.test(value)) {
    issues.push({
      severity: 'error',
      path,
      message: 'The color contains unsafe CSS syntax.',
      fix: 'Use a hex, RGB, HSL, OKLCH, or named color.',
    });
  }
}

function validateCssValue(value: string, path: string, issues: ValidationIssue[]): void {
  if (
    !value.trim() ||
    /[;{}<>]/.test(value) ||
    /(?:url|expression|var|env|attr)\s*\(/i.test(value)
  ) {
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
  if (Object.keys(template.blocks.calloutVariants).length > MAX_CALLOUT_VARIANTS) {
    issues.push({
      severity: 'error',
      path: 'blocks.calloutVariants',
      message: `A template may define at most ${String(MAX_CALLOUT_VARIANTS)} callout variants.`,
      fix: 'Remove unused callout variants before saving the template.',
    });
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
  validateColor(template.headings.h5.color, 'headings.h5.color', issues);
  validateColor(template.headings.h6.color, 'headings.h6.color', issues);
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
  validateColor(template.blocks.dividerColor, 'blocks.dividerColor', issues);
  validateColor(template.blocks.calloutAccent, 'blocks.calloutAccent', issues);
  validateColor(template.blocks.calloutBackground, 'blocks.calloutBackground', issues);
  validateColor(template.blocks.calloutTextColor, 'blocks.calloutTextColor', issues);
  validateColor(template.blocks.calloutTitleColor, 'blocks.calloutTitleColor', issues);
  validateColor(template.blocks.calloutIconColor, 'blocks.calloutIconColor', issues);
  validateColor(template.blocks.tableTextColor, 'blocks.tableTextColor', issues);
  validateColor(template.blocks.tableHeaderTextColor, 'blocks.tableHeaderTextColor', issues);
  validateColor(template.blocks.tableStripeColor, 'blocks.tableStripeColor', issues);
  validateColor(template.blocks.embedBackground, 'blocks.embedBackground', issues);
  validateColor(template.blocks.embedAccent, 'blocks.embedAccent', issues);
  validateColor(template.lists.markerColor, 'lists.markerColor', issues);
  validateColor(template.lists.indentGuideColor, 'lists.indentGuideColor', issues);
  validateColor(template.watermark.color, 'watermark.color', issues);
  for (const [type, variant] of Object.entries(template.blocks.calloutVariants)) {
    const path = `blocks.calloutVariants.${type}`;
    if (variant.accent !== undefined) {
      validateColor(variant.accent, `${path}.accent`, issues);
    }
    if (variant.background !== undefined) {
      validateColor(variant.background, `${path}.background`, issues);
    }
    if (variant.textColor !== undefined) {
      validateColor(variant.textColor, `${path}.textColor`, issues);
    }
    if (variant.titleColor !== undefined) {
      validateColor(variant.titleColor, `${path}.titleColor`, issues);
    }
    if (variant.iconColor !== undefined) {
      validateColor(variant.iconColor, `${path}.iconColor`, issues);
    }
  }
  if (template.images.duotone !== 'none' && !/^#[0-9a-f]{3,8}$/i.test(template.images.duotone)) {
    issues.push({
      severity: 'error',
      path: 'images.duotone',
      message: 'The duotone color must be a hex color such as #a34f2c, or “none”.',
      fix: 'Use “none” to disable the duotone treatment.',
    });
  }
  if (
    template.watermark.text.trim() &&
    /["\\\r\n;{}<>]/.test(template.watermark.text)
  ) {
    issues.push({
      severity: 'error',
      path: 'watermark.text',
      message: 'The watermark text cannot contain quotes, backslashes, or CSS punctuation.',
    });
  }
  validateCssValue(template.typography.bodyFont, 'typography.bodyFont', issues);
  validateCssValue(template.headings.h1.font, 'headings.h1.font', issues);
  validateCssValue(template.headings.h2.font, 'headings.h2.font', issues);
  validateCssValue(template.headings.h3.font, 'headings.h3.font', issues);
  validateCssValue(template.headings.h4.font, 'headings.h4.font', issues);
  validateCssValue(template.headings.h5.font, 'headings.h5.font', issues);
  validateCssValue(template.headings.h6.font, 'headings.h6.font', issues);
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
