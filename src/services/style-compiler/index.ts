import type {
  FontMetrics,
  HeadingLevelStyle,
  ImageFrame,
  TemplarNoteStyle,
  ValidationIssue,
} from '../../types';
import { MAX_GENERATED_STYLE_BYTES } from '../../constants';
import {
  alignedPageGap,
  blockSpacingForMode,
  fitToGrid,
  headingBaselinePadding,
} from '../../utils/grid';
import { round } from '../../utils/value';
import { compileCustomCss } from '../css-compiler';
import { px, safeValue, withOpacity } from './paper';

export interface PageMetricSet {
  body: FontMetrics;
  h1: FontMetrics;
  h2: FontMetrics;
  h3: FontMetrics;
  h4: FontMetrics;
  h5: FontMetrics;
  h6: FontMetrics;
  code: FontMetrics;
}

export interface StyleCompilation {
  css: string;
  issues: ValidationIssue[];
}


function patternDeclarations(
  style: TemplarNoteStyle,
  baselineAnchor: string,
  inlineStart: string,
): string {
  const { paper, baseline: grid } = style;
  const unit = grid.unit;
  const tile = unit * paper.patternScale;
  const halfUnit = px(tile / 2);
  const dotPosition = `calc(${inlineStart} - ${halfUnit}) calc(${baselineAnchor} - ${halfUnit})`;
  const gridPosition = `${inlineStart} ${baselineAnchor}`;
  const patternColor = withOpacity(
    safeValue(paper.patternColor, 'rgba(80, 120, 160, 0.3)'),
    paper.patternOpacity,
  );
  const majorColor = withOpacity(
    safeValue(paper.majorPatternColor, 'rgba(60, 100, 140, 0.35)'),
    paper.patternOpacity,
  );
  const marginColor = safeValue(paper.marginColor, 'rgba(200, 80, 80, 0.55)');
  const marginOffset =
    style.page.mode === 'paged' ? px(paper.marginOffset) : `min(${px(paper.marginOffset)}, 15%)`;
  const marginStart = `calc(${marginOffset} - 0.75px)`;
  const marginEnd = `calc(${marginOffset} + 0.75px)`;
  const marginLayer = `linear-gradient(to right, transparent 0, transparent ${marginStart}, ${marginColor} ${marginStart}, ${marginColor} ${marginEnd}, transparent ${marginEnd})`;
  const mirroredStart = `calc(100% - ${marginOffset} - 0.75px)`;
  const mirroredEnd = `calc(100% - ${marginOffset} + 0.75px)`;
  const ledgerLayer = `linear-gradient(to right, transparent 0, transparent ${marginStart}, ${marginColor} ${marginStart}, ${marginColor} ${marginEnd}, transparent ${marginEnd}, transparent ${mirroredStart}, ${marginColor} ${mirroredStart}, ${marginColor} ${mirroredEnd}, transparent ${mirroredEnd})`;

  const serializeLayers = (
    layers: string[],
    sizes: string[],
    positions: string[],
    repeats: string[],
  ): string => {
    if (
      layers.length !== sizes.length ||
      layers.length !== positions.length ||
      layers.length !== repeats.length
    ) {
      throw new Error('Templar paper-pattern layer declarations are out of sync.');
    }
    return `background-image: ${layers.join(',\n    ')};
  background-size: ${sizes.join(', ')};
  background-position: ${positions.join(', ')};
  background-repeat: ${repeats.join(', ')};`;
  };

  const withMarginLayer = (
    layers: string[],
    sizes: string[],
    positions: string[],
    repeats: string[],
  ): void => {
    if (!paper.marginLine) {
      return;
    }
    layers.unshift(marginLayer);
    sizes.unshift('100% 100%');
    positions.unshift('0 0');
    repeats.unshift('no-repeat');
  };

  if (paper.pattern === 'ruled' || paper.pattern === 'ledger') {
    // The baseline is the top edge of the ink. The one-pixel rule extends
    // downward so ordinary glyph bottoms remain clear while descenders cross it.
    const ruling = `linear-gradient(to bottom, ${patternColor} 0, ${patternColor} 1px, transparent 1px, transparent 100%)`;
    const marginLayerForPattern = paper.pattern === 'ledger' ? ledgerLayer : marginLayer;
    const layers = paper.marginLine || paper.pattern === 'ledger'
      ? `${marginLayerForPattern}, ${ruling}`
      : ruling;
    if (paper.marginLine || paper.pattern === 'ledger') {
      return `background-image: ${layers};
  background-size: 100% 100%, 100% ${px(tile)};
  background-position: 0 0, 0 ${baselineAnchor};
  background-repeat: no-repeat, repeat;`;
    }
    return `background-image: ${ruling};
  background-size: 100% ${px(tile)};
  background-position: 0 ${baselineAnchor};
  background-repeat: repeat;`;
  }

  if (paper.pattern === 'dot-grid') {
    const dots = `radial-gradient(circle, ${patternColor} ${px(paper.dotRadius)}, transparent calc(${px(paper.dotRadius)} * 1.25))`;
    const layers = [dots];
    const sizes = [`${px(tile)} ${px(tile)}`];
    const positions = [dotPosition];
    const repeats = ['repeat'];
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.pattern === 'graph') {
    const major = tile * paper.graphMajorInterval;
    const layers = [
      `linear-gradient(${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(90deg, ${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(${patternColor} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${patternColor} 1px, transparent 1px)`,
    ];
    const sizes = [
      `${px(major)} ${px(major)}`,
      `${px(major)} ${px(major)}`,
      `${px(tile)} ${px(tile)}`,
      `${px(tile)} ${px(tile)}`,
    ];
    const positions = [gridPosition, gridPosition, gridPosition, gridPosition];
    const repeats = ['repeat', 'repeat', 'repeat', 'repeat'];
    if (paper.marginLine) {
      layers.unshift(marginLayer);
      sizes.unshift('100% 100%');
      positions.unshift('0 0');
      repeats.unshift('no-repeat');
    }
    return `background-image: ${layers.join(',\n    ')};
  background-size: ${sizes.join(', ')};
  background-position: ${positions.join(', ')};
  background-repeat: ${repeats.join(', ')};`;
  }

  if (paper.pattern === 'diagonal' || paper.pattern === 'cross-hatch') {
    // A color stop at 1px only paints a corner of each tile. Centering the
    // stroke in the tile creates a continuous diagonal from edge to edge.
    const stroke = `linear-gradient(135deg, transparent calc(50% - 0.5px), ${patternColor} calc(50% - 0.5px), ${patternColor} calc(50% + 0.5px), transparent calc(50% + 0.5px))`;
    const counterStroke = `linear-gradient(45deg, transparent calc(50% - 0.5px), ${patternColor} calc(50% - 0.5px), ${patternColor} calc(50% + 0.5px), transparent calc(50% + 0.5px))`;
    const layers = paper.pattern === 'cross-hatch' ? [stroke, counterStroke] : [stroke];
    const sizes = layers.map(() => `${px(tile)} ${px(tile)}`);
    const positions = layers.map(() => gridPosition);
    const repeats = layers.map(() => 'repeat');
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.pattern === 'hex') {
    const hexWidth = tile * Math.sqrt(3);
    const hexHeight = tile * 2;
    const halfWidth = px(hexWidth / 2);
    const halfHeight = px(hexHeight / 2);
    const shiftedPosition = `calc(${inlineStart} + ${halfWidth}) calc(${baselineAnchor} + ${halfHeight})`;
    // Six interlocking edge layers form complete hexagons. Keeping every
    // layer explicit also prevents a margin layer from changing repeat rules.
    const hexLayers = [
      `linear-gradient(30deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(150deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(30deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(150deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(60deg, ${patternColor} 25%, transparent 25.5%, transparent 75%, ${patternColor} 75%)`,
      `linear-gradient(60deg, ${patternColor} 25%, transparent 25.5%, transparent 75%, ${patternColor} 75%)`,
    ];
    const hexSize = `${px(hexWidth)} ${px(hexHeight)}`;
    const hexSizes = hexLayers.map(() => hexSize);
    const hexPositions = [
      gridPosition,
      gridPosition,
      shiftedPosition,
      shiftedPosition,
      gridPosition,
      shiftedPosition,
    ];
    const hexRepeats = hexLayers.map(() => 'repeat');
    withMarginLayer(hexLayers, hexSizes, hexPositions, hexRepeats);
    return serializeLayers(hexLayers, hexSizes, hexPositions, hexRepeats);
  }

  if (paper.pattern === 'scallop') {
    const radius = tile / 2;
    const bump = `radial-gradient(circle at 50% 100%, transparent ${px(Math.max(0, radius - 0.75))}, ${patternColor} ${px(Math.max(0, radius - 0.5))}, ${patternColor} ${px(radius + 0.5)}, transparent ${px(radius + 0.75)})`;
    const layers = [bump, bump];
    const sizes = layers.map(() => `${px(tile)} ${px(tile)}`);
    const positions = [
      gridPosition,
      `calc(${inlineStart} + ${halfUnit}) calc(${baselineAnchor} + ${halfUnit})`,
    ];
    const repeats = layers.map(() => 'repeat');
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.marginLine) {
    return `background-image: ${marginLayer};
  background-size: 100% 100%;
  background-repeat: no-repeat;`;
  }
  return 'background-image: none;';
}

function horizontalPadding(value: number, side: 'left' | 'right', paged: boolean): string {
  if (paged || value <= 24) {
    return px(value);
  }
  return `min(${px(value)}, ${side === 'left' ? '18%' : '12%'})`;
}

function headingDecoration(style: HeadingLevelStyle): string {
  switch (style.decoration) {
    case 'underline':
      return 'text-decoration: underline; text-decoration-thickness: 0.08em; text-underline-offset: 0.16em;';
    case 'rule':
      return 'box-shadow: inset 0 -1px currentColor;';
    case 'highlight':
      return 'background-image: linear-gradient(to top, color-mix(in srgb, currentColor 18%, transparent) 42%, transparent 42%);';
    case 'none':
      return '';
  }
}

function headingRule(
  scope: string,
  level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
  style: HeadingLevelStyle,
  metric: FontMetrics,
  bodyBaseline: number,
  gridUnit: number,
  gridded: boolean,
): string {
  const liveClass = level === 'h1'
    ? ':is(.HyperMD-header-1, .inline-title)'
    : `.HyperMD-header-${level[1]}`;
  const lineHeight = gridded ? fitToGrid(style.size * 1.18, gridUnit) : style.size * 1.2;
  const padding = gridded
    ? headingBaselinePadding(
      bodyBaseline,
      metric.baseline,
      gridUnit,
      metric.lineHeight,
    )
    : { top: 0, bottom: 0 };
  const readingMargin = gridded ? `${px(gridUnit)} 0` : '1.35em 0.55em';
  const editorPadding = gridded
    ? `${px(gridUnit + padding.top)} ${px(padding.bottom)}`
    : '1.35em 0.55em';
  return `${scope} .templar-page :is(${level}, ${liveClass}) {
  color: ${safeValue(style.color, 'currentColor')};
  font-family: ${safeValue(style.font, 'inherit')};
  font-size: ${px(style.size)};
  font-weight: ${String(style.weight)};
  letter-spacing: ${px(style.letterSpacing)};
  line-height: ${px(lineHeight)};
  text-transform: ${style.textTransform};
  ${headingDecoration(style)}
}

${scope} .markdown-preview-view.templar-page ${level} {
  margin-block: ${readingMargin} !important;
  padding-block: ${px(padding.top)} ${px(padding.bottom)} !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page ${liveClass} {
  box-sizing: border-box;
  margin-block: 0 !important;
  padding-block: ${editorPadding} !important;
}`;
}

function frameAdjustments(frame: ImageFrame): string {
  switch (frame) {
    case 'none':
      return '';
    case 'thin':
    case 'technical':
      return 'background: transparent;';
    case 'photo':
    case 'polaroid':
    case 'scrapbook':
      return 'background: var(--templar-image-border);';
    case 'rounded':
      return 'overflow: hidden;';
    case 'dark':
      return 'background: #2b2724;';
    case 'vintage':
      return 'background: #f0e2c5;';
  }
}

function attachmentFrameDeclarations(frame: ImageFrame): string[] {
  switch (frame) {
    case 'none':
      return ['background: transparent', 'border-width: 0', 'border-radius: 0', 'box-shadow: none'];
    case 'thin':
      return ['background: transparent', 'border-width: 1px'];
    case 'photo':
      return ['background: var(--templar-image-border)', 'border-width: 6px'];
    case 'polaroid':
      return [
        'background: var(--templar-image-border)',
        'border-width: 10px',
        'border-bottom-width: 32px',
      ];
    case 'scrapbook':
      return ['background: var(--templar-image-border)', 'border-width: 8px'];
    case 'rounded':
      return ['background: transparent', 'border-width: 0', 'border-radius: 12px', 'overflow: hidden'];
    case 'technical':
      return ['background: transparent', 'border-width: 2px', 'border-radius: 2px'];
    case 'dark':
      return ['background: #2b2724', 'border-color: #2b2724', 'border-width: 8px'];
    case 'vintage':
      return ['background: #f0e2c5', 'border-color: #f0e2c5', 'border-width: 8px'];
  }
}

function attachmentRules(style: TemplarNoteStyle, scope: string): string {
  if (!style.attachments) {
    return '';
  }
  const rules: string[] = [];
  for (const [fileName, override] of Object.entries(style.attachments)) {
    const encoded = encodeURIComponent(fileName).replace(/"/g, '%22');
    const declarations: string[] = [];
    if (override.rotation !== undefined) {
      declarations.push(`transform: rotate(${String(override.rotation)}deg)`);
    }
    if (override.width !== undefined) {
      declarations.push(`width: ${String(override.width)}px`, 'max-width: 100%');
    }
    if (override.frame) {
      declarations.push(...attachmentFrameDeclarations(override.frame));
    }
    if (declarations.length > 0) {
      rules.push(
        `${scope} .templar-page img[src*="${encoded}"] { ${declarations.join('; ')}; }`,
      );
    }
  }
  return rules.join('\n');
}

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3 || cleaned.length === 4
      ? cleaned
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : cleaned;
  const match = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(full);
  if (!match) {
    return null;
  }
  const r = parseInt(match[1] ?? '', 16) / 255;
  const g = parseInt(match[2] ?? '', 16) / 255;
  const b = parseInt(match[3] ?? '', 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function duotoneFilter(hex: string): string {
  const target = hexToHsl(hex);
  if (!target) {
    return '';
  }
  // A full sepia pass lands near hsl(38, 50%, 50%); rotate and rescale the
  // channel percentages toward the requested color for a believable duotone.
  const hue = round(target.h - 38);
  const saturation = round(target.s / 50, 2);
  const lightness = round(target.l / 50, 2);
  return `grayscale(1) sepia(1) hue-rotate(${String(hue)}deg) saturate(${String(saturation)}) brightness(${String(lightness)})`;
}

function imageFilter(style: TemplarNoteStyle): string {
  const legacy = `sepia(${String(style.images.sepia)}) grayscale(${String(style.images.grayscale)}) saturate(${String(style.images.saturation)}) contrast(${String(style.images.contrast)})`;
  if (style.images.duotone === 'none') {
    return legacy;
  }
  const duotone = duotoneFilter(style.images.duotone);
  return duotone ? `${duotone} ${legacy}` : legacy;
}

function dividerDeclarations(style: TemplarNoteStyle): string {
  const color = safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)');
  const width = Math.max(style.blocks.dividerWidth, 1);
  switch (style.blocks.dividerStyle) {
    case 'dashed':
      return `border-block-start: ${px(width)} dashed ${color};`;
    case 'dotted':
      return `border-block-start: ${px(width)} dotted ${color};`;
    case 'double':
      return `border-block-start: ${px(Math.max(width, 3))} double ${color};`;
    case 'fade':
      return `border-block-start: ${px(width)} solid ${color};
  -webkit-mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);`;
    case 'solid':
    default:
      return `border-block-start: ${px(width)} solid ${color};`;
  }
}

function griddedDividerDeclarations(style: TemplarNoteStyle, unit: number): string {
  const color = safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)');
  const thickness = Math.max(1, Math.min(style.blocks.dividerWidth, unit / 3));
  const size = px(thickness);
  let background: string;
  switch (style.blocks.dividerStyle) {
    case 'dashed':
      background = `repeating-linear-gradient(to right, ${color} 0 12px, transparent 12px 20px) center / 100% ${size} no-repeat`;
      break;
    case 'dotted':
      background = `radial-gradient(circle closest-side, ${color} 90%, transparent) left center / ${px(thickness * 2.4)} ${size} repeat-x`;
      break;
    case 'double': {
      const stroke = Math.max(1, thickness / 3);
      const offset = Math.max(stroke, thickness / 3);
      background = `linear-gradient(${color}, ${color}) center calc(50% - ${px(offset)}) / 100% ${px(stroke)} no-repeat, linear-gradient(${color}, ${color}) center calc(50% + ${px(offset)}) / 100% ${px(stroke)} no-repeat`;
      break;
    }
    case 'fade':
      background = `linear-gradient(to right, transparent, ${color} 10%, ${color} 90%, transparent) center / 100% ${size} no-repeat`;
      break;
    case 'solid':
    default:
      background = `linear-gradient(${color}, ${color}) center / 100% ${size} no-repeat`;
      break;
  }
  return `background: ${background};
  border: 0 !important;
  box-sizing: border-box;
  height: ${px(unit)} !important;
  min-height: ${px(unit)} !important;
  margin-block: 0 !important;
  padding: 0 !important;`;
}

function calloutRules(style: TemplarNoteStyle, scope: string): string {
  const { blocks } = style;
  const accent = safeValue(blocks.calloutAccent, '#9fb8ca');
  const background = safeValue(blocks.calloutBackground, 'rgba(159, 184, 202, 0.12)');
  const textColor = safeValue(blocks.calloutTextColor, '#302e2b');
  const titleColor = safeValue(blocks.calloutTitleColor, '#302e2b');
  const iconColor = safeValue(blocks.calloutIconColor, '#9fb8ca');
  const base = `${scope} .templar-page :is(.callout, .cm-callout) {
  --callout-background: ${background};
  --callout-border-color: ${accent};
  --callout-border-width: ${px(blocks.calloutBorderWidth)};
  background-color: ${background};
  border-color: ${accent};
  border-radius: ${px(blocks.calloutRadius)};
  /* Obsidian themes may blend callouts against the workspace background.
     Templar supplies an isolated paper surface and a complete callout palette,
     so theme blend modes can erase otherwise valid dark-on-light callouts. */
  mix-blend-mode: normal;
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-content {
  color: ${textColor};
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-title {
  color: ${titleColor};
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-icon {
  color: ${iconColor};
}`;
  const variantRules: string[] = [];
  for (const [type, variant] of Object.entries(blocks.calloutVariants)) {
    const containerDeclarations: string[] = [];
    if (variant.accent !== undefined) {
      const value = safeValue(variant.accent, accent);
      containerDeclarations.push(
        `--callout-border-color: ${value};`,
        `border-color: ${value};`,
      );
    }
    if (variant.background !== undefined) {
      const value = safeValue(variant.background, background);
      containerDeclarations.push(`--callout-background: ${value};`, `background-color: ${value};`);
    }
    if (containerDeclarations.length > 0) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] {
  ${containerDeclarations.join('\n  ')}
}`,
      );
    }
    const innerDeclarations: string[] = [];
    if (variant.textColor !== undefined) {
      innerDeclarations.push(`color: ${safeValue(variant.textColor, textColor)};`);
    }
    if (innerDeclarations.length > 0) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-content {
  ${innerDeclarations.join('\n  ')}
}`,
      );
    }
    if (variant.titleColor !== undefined) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-title {
  color: ${safeValue(variant.titleColor, titleColor)};
}`,
      );
    }
    if (variant.iconColor !== undefined) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-icon {
  color: ${safeValue(variant.iconColor, iconColor)};
}`,
      );
    }
  }
  return variantRules.length > 0 ? `${base}\n\n${variantRules.join('\n\n')}` : base;
}

function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\fffd ')
    .replace(/\r/g, '\\d ')
    .replace(/\n/g, '\\a ')
    .replace(/\f/g, '\\c ')
    .replace(/"/g, '\\"');
}

export function compilePageStyle(
  style: TemplarNoteStyle,
  scope: string,
  scopeId: string,
  metrics: PageMetricSet,
): StyleCompilation {
  const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
  const unit = style.baseline.unit;
  const bodyLineHeight = gridded
    ? unit
    : style.typography.bodyLineHeight > 0
      ? style.typography.bodyLineHeight
      : Math.max(style.typography.bodySize * 1.55, 22);
  const effectiveBaselineMode = gridded ? style.baseline.mode : 'free';
  const blockSpacing = blockSpacingForMode(
    effectiveBaselineMode,
    unit,
    bodyLineHeight,
  );
  const baselinePosition = style.layout.paddingTop + metrics.body.baseline;
  const borderBottom = Math.max(style.images.borderWidth, style.images.bottomBorderWidth);
  const imageBottom = style.images.bottomSpacing;
  const paged = style.page.mode === 'paged';
  const pageGap = gridded
    ? alignedPageGap(style.page.height, style.page.gap, unit)
    : style.page.gap;
  const pageSpan = style.page.height + pageGap;
  const printableHeight = Math.max(
    unit,
    style.page.height - style.layout.paddingTop - style.layout.paddingBottom,
  );
  const bodyFont = safeValue(style.typography.bodyFont, 'Georgia, serif');
  const paperColor = safeValue(style.paper.color, '#fffdf7');
  const textColor = safeValue(style.typography.textColor, '#302e2b');
  const mutedColor = safeValue(style.typography.mutedColor, '#706c66');
  const imageBorder = safeValue(style.images.borderColor, '#ffffff');
  const watermarkText = escapeCssString(style.watermark.text);
  const paddingRight = horizontalPadding(style.layout.paddingRight, 'right', paged);
  const paddingLeft = horizontalPadding(style.layout.paddingLeft, 'left', paged);
  const pattern = patternDeclarations(
    style,
    'var(--templar-paper-baseline-position)',
    paddingLeft,
  );
  const codePadding = gridded
    ? headingBaselinePadding(
      metrics.body.baseline,
      metrics.code.baseline,
      unit,
      metrics.code.lineHeight,
    )
    : { top: unit / 2, bottom: unit / 2 };

  const baseCss = `${scope} {
  --templar-grid: ${px(unit)};
  --templar-baseline-position: ${px(baselinePosition)};
  --templar-editor-baseline-position: ${px(baselinePosition)};
  --templar-paper-baseline-position: var(--templar-editor-baseline-position);
  --templar-image-border: ${imageBorder};
  --templar-page-width: ${px(style.page.width)};
  --templar-page-height: ${px(style.page.height)};
  --templar-page-gap: ${px(pageGap)};
  --templar-page-span: ${px(pageSpan)};
  --templar-page-scale: 1;
  --templar-body-line-height: ${px(bodyLineHeight)};
  --templar-watermark: "${watermarkText}";
}

${scope} .templar-page {
  ${paged ? 'background: var(--background-secondary);' : `background-color: ${paperColor};`}
  border-radius: ${paged ? '0' : px(style.layout.pageRadius)};
  box-shadow: ${paged ? 'none' : safeValue(style.layout.pageShadow, 'none')};
  color: ${textColor};
  font-family: ${bodyFont};
  font-size: ${px(style.typography.bodySize)};
  font-weight: ${String(style.typography.bodyWeight)};
  line-height: ${px(bodyLineHeight)};
  min-height: 100%;
  overflow-x: ${paged ? 'auto' : 'hidden'};
  padding: 0 !important;
}

${scope} .markdown-preview-view.templar-page,
${scope} .markdown-source-view.mod-cm6 .cm-scroller.templar-page {
  padding: 0 !important;
}

${scope} .markdown-source-view.mod-cm6 .cm-scroller.templar-page {
  color: ${textColor};
  font-family: ${bodyFont};
  font-size: ${px(style.typography.bodySize)};
  font-weight: ${String(style.typography.bodyWeight)};
  line-height: ${px(bodyLineHeight)};
}

${scope} .templar-page-content {
  ${paged ? '' : 'background-color: transparent;'}
  box-sizing: border-box;
  isolation: isolate;
  margin-inline: auto;
  max-width: ${paged ? 'none' : px(style.layout.maxWidth)};
  min-height: ${paged ? `var(--templar-canvas-height, ${px(style.page.height)})` : '100%'};
  padding: ${px(style.layout.paddingTop)} ${paddingRight} ${px(style.layout.paddingBottom)} ${paddingLeft};
  position: relative;
  width: ${paged ? px(style.page.width) : '100%'};
  zoom: ${paged ? 'var(--templar-page-scale)' : '1'};
}

${paged ? '' : `${scope} .templar-page-content::before {
  ${pattern}
  background-color: ${paperColor};
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: -1;
}

`}${scope} .templar-page-content::after {
  color: ${safeValue(style.watermark.color, 'rgba(48, 46, 43, 0.1)')};
  content: var(--templar-watermark, "");
  display: grid;
  font-size: ${px(style.watermark.size)};
  inset: 0;
  line-height: 1;
  opacity: ${String(style.watermark.opacity)};
  place-items: center;
  pointer-events: none;
  position: absolute;
  transform: rotate(${String(style.watermark.rotation)}deg);
  user-select: none;
  white-space: pre;
  z-index: -1;
}

${paged ? `${scope} .templar-page-content::before {
  ${pattern}
  -webkit-mask-image: repeating-linear-gradient(to bottom, #000 0, #000 ${px(style.page.height)}, transparent ${px(style.page.height)}, transparent ${px(pageSpan)});
  background-color: ${paperColor};
  content: "";
  filter: drop-shadow(0 3px 12px rgba(0, 0, 0, 0.16));
  inset: 0;
  mask-image: repeating-linear-gradient(to bottom, #000 0, #000 ${px(style.page.height)}, transparent ${px(style.page.height)}, transparent ${px(pageSpan)});
  pointer-events: none;
  position: absolute;
  z-index: -1;
}

` : ''}

${scope} .templar-page-content.markdown-preview-sizer,
${scope} .templar-page-content.cm-sizer,
${scope} .markdown-preview-view.templar-page .templar-page-content.markdown-preview-sizer,
${scope} .markdown-source-view.mod-cm6 .templar-page-content.cm-sizer {
  box-sizing: border-box !important;
  max-width: ${paged ? 'none' : px(style.layout.maxWidth)};
  padding: ${px(style.layout.paddingTop)} ${paddingRight} ${px(style.layout.paddingBottom)} ${paddingLeft} !important;
  width: ${paged ? px(style.page.width) : '100%'};
}

${scope} .templar-page .cm-content,
${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content {
  caret-color: ${textColor};
  line-height: ${px(bodyLineHeight)};
  max-width: none;
  padding: 0;
  width: 100%;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line {
  box-sizing: border-box;
  margin-block: 0 !important;
}

${paged ? `${scope} .templar-page .cm-line,
${scope} .markdown-source-view.mod-cm6 .templar-page .cm-line {
  max-width: none;
}` : ''}

${scope} .templar-page :is(p, li, .HyperMD-paragraph, .HyperMD-list-line, .HyperMD-quote) {
  line-height: ${px(bodyLineHeight)};
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.HyperMD-list-line {
  line-height: ${px(bodyLineHeight)} !important;
  margin-block: 0 !important;
  min-height: ${px(bodyLineHeight)} !important;
  padding-block: 0 !important;
}

${scope} .templar-page-content li {
  margin-block: 0 !important;
  padding-block: 0 !important;
}

${scope} .templar-page-content li > :is(p, ul, ol) {
  line-height: ${px(bodyLineHeight)};
  margin-block: 0 !important;
}

${scope} .markdown-preview-view.templar-page :is(p, ul, ol, blockquote, pre, table) {
  margin-block: 0 ${px(blockSpacing)} !important;
}

${scope} .markdown-preview-view.templar-page li > :is(p, ul, ol) {
  margin-block: 0 !important;
}

${headingRule(scope, 'h1', style.headings.h1, metrics.h1, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h2', style.headings.h2, metrics.h2, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h3', style.headings.h3, metrics.h3, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h4', style.headings.h4, metrics.h4, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h5', style.headings.h5, metrics.h5, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h6', style.headings.h6, metrics.h6, metrics.body.baseline, unit, gridded)}

${scope} .templar-page :is(a, .cm-hmd-internal-link, .cm-link, .cm-url) {
  color: ${safeValue(style.blocks.linkColor, '#315f86')};
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}

${scope} .templar-page mark,
${scope} .markdown-source-view.mod-cm6 .templar-page :is(.cm-highlight, .cm-formatting-highlight) {
  background-color: ${safeValue(style.blocks.highlightBackground, 'rgba(246, 210, 74, 0.52)')};
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  color: ${safeValue(style.blocks.highlightTextColor, '#302e2b')};
}

${scope} .templar-page :is(blockquote, .HyperMD-quote) {
  background: ${safeValue(style.blocks.quoteBackground, 'transparent')};
  border-inline-start: 3px solid ${safeValue(style.blocks.quoteAccent, 'currentColor')};
  color: ${safeValue(style.blocks.quoteTextColor, textColor)};
  padding-inline: ${px(unit / 2)};
}

${scope} .templar-page :is(code, .cm-inline-code) {
  background: ${safeValue(style.blocks.codeBackground, 'rgba(0, 0, 0, 0.08)')};
  color: ${safeValue(style.blocks.codeTextColor, textColor)};
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
}

${scope} .templar-page pre {
  background: ${safeValue(style.blocks.codeBackground, 'rgba(0, 0, 0, 0.08)')};
  color: ${safeValue(style.blocks.codeTextColor, textColor)};
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
  line-height: ${px(bodyLineHeight)} !important;
  padding: ${px(codePadding.top)} ${px(unit / 2)} ${px(codePadding.bottom)} !important;
}

${scope} .templar-page pre > code {
  background: transparent;
  color: inherit;
  display: block;
  font: inherit;
  line-height: inherit;
  padding: 0 !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.HyperMD-codeblock {
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
  line-height: ${px(bodyLineHeight)} !important;
  min-height: ${px(bodyLineHeight)} !important;
  padding-block: 0 !important;
}

${scope} .templar-page table {
  border-collapse: collapse;
  border-color: ${safeValue(style.blocks.tableBorder, 'currentColor')};
  font-size: ${px(style.blocks.tableFontSize)};
}

${scope} .templar-page :is(th, td) {
  border-color: ${safeValue(style.blocks.tableBorder, 'currentColor')};
  border-width: ${px(style.blocks.tableBorderWidth)};
  padding: ${px(style.blocks.tablePadding)};
  text-align: start;
}

${scope} .templar-page th {
  background: ${safeValue(style.blocks.tableHeaderBackground, 'transparent')};
  color: ${safeValue(style.blocks.tableHeaderTextColor, textColor)};
}

${scope} .templar-page td {
  color: ${safeValue(style.blocks.tableTextColor, textColor)};
}

${style.blocks.tableStriped ? `${scope} .templar-page tbody tr:nth-child(even) {
  background: ${safeValue(style.blocks.tableStripeColor, 'rgba(48, 46, 43, 0.045)')};
}

` : ''}${scope} .templar-page hr {
  ${gridded
    ? griddedDividerDeclarations(style, unit)
    : `${dividerDeclarations(style)}
  border-bottom: 0;
  border-inline: 0;
  margin-block: ${px(blockSpacing)} !important;`}
}

${scope} .templar-page .HyperMD-hr {
  ${gridded
    ? griddedDividerDeclarations(style, unit)
    : 'border: 0 !important; margin-block: 0 !important; padding-block: 0 !important;'}
}

${scope} .templar-page .cm-hr {
  ${gridded
    ? 'background: transparent; border: 0; height: 100%; width: 100%;'
    : `background-color: ${safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)')};
  height: ${px(Math.max(style.blocks.dividerWidth, 1))};`}
  margin: 0;
  padding: 0;
  ${!gridded && style.blocks.dividerStyle === 'fade'
    ? `-webkit-mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);`
    : ''}
}

${calloutRules(style, scope)}

${scope} .templar-page :is(.internal-embed, .file-embed) {
  background: ${safeValue(style.blocks.embedBackground, 'rgba(48, 46, 43, 0.06)')};
  border-radius: ${px(style.blocks.embedRadius)};
}

${scope} .templar-page :is(.markdown-embed-link, .markdown-embed-title, .file-embed-title) {
  color: ${safeValue(style.blocks.embedAccent, '#9fb8ca')};
}

${scope} .templar-page :is(ul, ol) :is(ul, ol) {
  ${style.lists.nestedIndent > 0
    ? `padding-inline-start: ${px(style.lists.nestedIndent)} !important;`
    : ''}
  ${style.lists.indentGuides
    ? `border-inline-start: 1px solid ${safeValue(style.lists.indentGuideColor, 'rgba(48, 46, 43, 0.18)')};`
    : ''}
}

${scope} .templar-page ul {
  list-style-type: ${style.lists.markerStyle};
}

${scope} .templar-page :is(ul, ol) li::marker {
  color: ${safeValue(style.lists.markerColor, '#706c66')};
}

${scope} .templar-page ul .list-bullet {
  display: none;
}

${scope} .markdown-source-view.mod-cm6 .templar-page :is(.cm-formatting-list-ul, .cm-formatting-list-ol) {
  color: ${safeValue(style.lists.markerColor, '#706c66')};
}

${style.typography.firstLineIndent > 0 ? `${scope} .templar-page-content p {
  text-indent: ${px(style.typography.firstLineIndent)};
}

` : ''}${style.typography.dropCap ? `${scope} .templar-page-content :is(h1, h2, h3) ~ p:first-of-type::first-letter,
${scope} .templar-page-content .HyperMD-header + .HyperMD-paragraph::first-letter {
  float: left;
  font-size: 3.2em;
  font-weight: 700;
  line-height: 0.8;
  margin-block-start: 0.04em;
  margin-inline-end: 0.1em;
}

` : ''}${scope} .markdown-preview-view.templar-page .templar-blank-line-spacer {
  height: calc(var(--templar-body-line-height) * var(--templar-blank-lines, 1));
  margin: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  pointer-events: none;
}

${gridded ? `${scope} .templar-grid-snap-block:not(:is(table, iframe, object, video, audio, canvas)) {
  /* Keep renderer-owned child margins inside the measured footprint. Without
     a block formatting context, display-math and other widgets can collapse a
     top margin outside their snapped owner and permanently shift later text. */
  display: flow-root;
}

${scope} .templar-grid-snap-block:not(:is(table, iframe, object, video, audio, canvas))::after {
  block-size: var(--templar-grid-snap, 0px);
  clear: both;
  content: "";
  display: block;
  inline-size: 100%;
  pointer-events: none;
}

${scope} .templar-grid-snap-block:is(table, iframe, object, video, audio, canvas) {
  margin-block-end: calc(var(--templar-grid-natural-margin-end, 0px) + var(--templar-grid-snap, 0px)) !important;
}

` : ''}${scope} .templar-page input[type="checkbox"] {
  accent-color: ${safeValue(style.blocks.checkboxAccent, '#507b5c')};
}

${scope} .templar-page :is(figcaption, small, .cm-comment, .list-bullet, .collapse-indicator, .footnote-ref) {
  color: ${mutedColor};
}

${scope} .templar-page img {
  ${frameAdjustments(style.images.frame)}
  border-color: ${imageBorder};
  border-style: solid;
  border-width: ${px(style.images.borderWidth)} ${px(style.images.borderWidth)} ${px(borderBottom)};
  border-radius: ${px(style.images.cornerRadius)};
  box-shadow: ${safeValue(style.images.shadow, 'none')};
  box-sizing: border-box;
  display: block;
  filter: ${imageFilter(style)};
  float: ${style.images.float};
  margin-block: ${px(style.images.topSpacing)} calc(${px(imageBottom)} + var(--templar-image-snap, 0px));
  margin-inline: ${style.images.float === 'left' ? '0 1em 0 0' : style.images.float === 'right' ? '0 0 0 1em' : 'auto'};
  max-height: ${paged ? px(printableHeight) : 'none'};
  max-width: ${String(style.images.maxWidth)}%;
  object-fit: ${style.images.objectFit};
  opacity: ${String(style.images.opacity)};
  transform: rotate(${String(style.images.rotation)}deg);
}

${scope} .templar-page .metadata-container [data-property-key="templar"] {
  display: none;
}

${scope} .templar-page .metadata-container:not(:has([data-property-key]:not([data-property-key="templar"]))) {
  display: none;
}

${attachmentRules(style, scope)}`;

  const custom = compileCustomCss(style.css, scope, scopeId, gridded);
  const fixedCanvasGuard = paged
    ? `${scope} .templar-page-content,
${scope} .markdown-preview-view.templar-page .templar-page-content.markdown-preview-sizer,
${scope} .markdown-source-view.mod-cm6 .templar-page-content.cm-sizer {
  block-size: auto !important;
  box-sizing: border-box !important;
  columns: auto !important;
  contain: none !important;
  container-type: normal !important;
  content-visibility: visible !important;
  display: block !important;
  float: none !important;
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  height: auto !important;
  inline-size: ${px(style.page.width)} !important;
  inset: auto !important;
  isolation: isolate !important;
  line-height: inherit !important;
  margin-block: 0 !important;
  margin-inline: auto !important;
  max-block-size: none !important;
  max-height: none !important;
  max-inline-size: ${px(style.page.width)} !important;
  max-width: ${px(style.page.width)} !important;
  min-block-size: var(--templar-canvas-height, ${px(style.page.height)}) !important;
  min-height: var(--templar-canvas-height, ${px(style.page.height)}) !important;
  min-inline-size: ${px(style.page.width)} !important;
  min-width: ${px(style.page.width)} !important;
  opacity: 1 !important;
  overflow: visible !important;
  padding: ${px(style.layout.paddingTop)} ${px(style.layout.paddingRight)} ${px(style.layout.paddingBottom)} ${px(style.layout.paddingLeft)} !important;
  position: relative !important;
  rotate: none !important;
  scale: none !important;
  transform: none !important;
  translate: none !important;
  visibility: visible !important;
  width: ${px(style.page.width)} !important;
  writing-mode: horizontal-tb !important;
  zoom: var(--templar-page-scale) !important;
}`
    : '';
  const pageBreakGuard = paged
    ? `${scope} .templar-page .templar-page-content [style*="--templar-page-break"] {
  margin-block-start: calc(var(--templar-original-margin-top, 0px) + var(--templar-page-break, 0px)) !important;
}`
    : '';
  const css = `${baseCss}\n\n${custom.css}\n\n${fixedCanvasGuard}\n\n${pageBreakGuard}`;
  if (new TextEncoder().encode(css).length > MAX_GENERATED_STYLE_BYTES) {
    return {
      css: '',
      issues: [
        ...custom.issues,
        {
          severity: 'error',
          path: 'css.generated',
          message: 'The generated note stylesheet exceeds the 1 MiB safety limit.',
          fix: 'Reduce callout variants, attachment overrides, and repeated custom CSS.',
        },
      ],
    };
  }
  return { css, issues: custom.issues };
}
