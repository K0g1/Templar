import type {
  FontMetrics,
  HeadingLevelStyle,
  ImageFrame,
  TemplarNoteStyle,
  ValidationIssue,
} from '../types';
import {
  alignedPageGap,
  blockSpacingForMode,
  fitToGrid,
  headingBaselinePadding,
} from '../utils/grid';
import { round } from '../utils/value';
import { compileCustomCss } from './css-compiler';

export interface PageMetricSet {
  body: FontMetrics;
  h1: FontMetrics;
  h2: FontMetrics;
  h3: FontMetrics;
  h4: FontMetrics;
  code: FontMetrics;
}

export interface StyleCompilation {
  css: string;
  issues: ValidationIssue[];
}

function safeValue(value: string, fallback: string): string {
  if (!value.trim() || /[;{}<>]/.test(value) || /(?:url|expression)\s*\(/i.test(value)) {
    return fallback;
  }
  return value;
}

function px(value: number): string {
  return `${String(round(value))}px`;
}

function patternDeclarations(
  style: TemplarNoteStyle,
  baseline: number,
  inlineStart: string,
): string {
  const { paper, baseline: grid } = style;
  const unit = grid.unit;
  const baselineAnchor = px(baseline);
  const halfUnit = px(unit / 2);
  const dotPosition = `calc(${inlineStart} - ${halfUnit}) calc(${baselineAnchor} - ${halfUnit})`;
  const gridPosition = `${inlineStart} ${baselineAnchor}`;
  const patternColor = safeValue(paper.patternColor, 'rgba(80, 120, 160, 0.3)');
  const majorColor = safeValue(paper.majorPatternColor, 'rgba(60, 100, 140, 0.35)');
  const marginColor = safeValue(paper.marginColor, 'rgba(200, 80, 80, 0.55)');
  const marginOffset =
    style.page.mode === 'paged' ? px(paper.marginOffset) : `min(${px(paper.marginOffset)}, 15%)`;
  const marginStart = `calc(${marginOffset} - 0.75px)`;
  const marginEnd = `calc(${marginOffset} + 0.75px)`;
  const marginLayer = `linear-gradient(to right, transparent 0, transparent ${marginStart}, ${marginColor} ${marginStart}, ${marginColor} ${marginEnd}, transparent ${marginEnd})`;

  if (paper.pattern === 'ruled') {
    // The baseline is the top edge of the ink. The one-pixel rule extends
    // downward so ordinary glyph bottoms remain clear while descenders cross it.
    const ruling = `linear-gradient(to bottom, ${patternColor} 0, ${patternColor} 1px, transparent 1px, transparent 100%)`;
    if (paper.marginLine) {
      return `background-image: ${marginLayer}, ${ruling};
  background-size: 100% 100%, 100% ${px(unit)};
  background-position: 0 0, 0 ${baselineAnchor};
  background-repeat: no-repeat, repeat;`;
    }
    return `background-image: ${ruling};
  background-size: 100% ${px(unit)};
  background-position: 0 ${baselineAnchor};
  background-repeat: repeat;`;
  }

  if (paper.pattern === 'dot-grid') {
    const dots = `radial-gradient(circle, ${patternColor} 1px, transparent 1.25px)`;
    return paper.marginLine
      ? `background-image: ${marginLayer}, ${dots};
  background-size: 100% 100%, ${px(unit)} ${px(unit)};
  background-position: 0 0, ${dotPosition};
  background-repeat: no-repeat, repeat;`
      : `background-image: ${dots};
  background-size: ${px(unit)} ${px(unit)};
  background-position: ${dotPosition};`;
  }

  if (paper.pattern === 'graph') {
    const major = unit * 5;
    const layers = [
      `linear-gradient(${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(90deg, ${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(${patternColor} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${patternColor} 1px, transparent 1px)`,
    ];
    const sizes = [
      `${px(major)} ${px(major)}`,
      `${px(major)} ${px(major)}`,
      `${px(unit)} ${px(unit)}`,
      `${px(unit)} ${px(unit)}`,
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
      return 'border-bottom: 1px solid currentColor;';
    case 'highlight':
      return 'background-image: linear-gradient(to top, color-mix(in srgb, currentColor 18%, transparent) 42%, transparent 42%);';
    case 'none':
      return '';
  }
}

function headingRule(
  scope: string,
  level: 'h1' | 'h2' | 'h3' | 'h4',
  style: HeadingLevelStyle,
  metric: FontMetrics,
  bodyBaseline: number,
  gridUnit: number,
  gridded: boolean,
): string {
  const liveClass = level === 'h1' ? '.HyperMD-header-1, .inline-title' : `.HyperMD-header-${level[1]}`;
  const lineHeight = gridded ? fitToGrid(style.size * 1.18, gridUnit) : style.size * 1.2;
  const padding = gridded
    ? headingBaselinePadding(bodyBaseline, metric.baseline, gridUnit)
    : { top: 0, bottom: 0 };
  return `${scope} .templar-page :is(${level}, ${liveClass}) {
  color: ${safeValue(style.color, 'currentColor')};
  font-family: ${safeValue(style.font, 'inherit')};
  font-size: ${px(style.size)};
  font-weight: ${String(style.weight)};
  line-height: ${px(lineHeight)};
  margin-block: ${gridded ? `${px(gridUnit)} 0` : '1.35em 0.55em'} !important;
  padding-block: ${px(padding.top)} ${px(padding.bottom)} !important;
  ${headingDecoration(style)}
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

export function compilePageStyle(
  style: TemplarNoteStyle,
  scope: string,
  scopeId: string,
  metrics: PageMetricSet,
): StyleCompilation {
  const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
  const unit = style.baseline.unit;
  const bodyLineHeight = gridded ? unit : Math.max(style.typography.bodySize * 1.55, 22);
  const blockSpacing = blockSpacingForMode(
    style.baseline.mode,
    unit,
    bodyLineHeight,
  );
  const baselinePosition = style.layout.paddingTop + metrics.body.baseline;
  const borderBottom = Math.max(style.images.borderWidth, style.images.bottomBorderWidth);
  const imageBottom = style.images.bottomSpacing;
  const paged = style.page.mode === 'paged';
  const pageGap = alignedPageGap(style.page.height, style.page.gap, unit);
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
  const paddingRight = horizontalPadding(style.layout.paddingRight, 'right', paged);
  const paddingLeft = horizontalPadding(style.layout.paddingLeft, 'left', paged);
  const pattern = patternDeclarations(style, baselinePosition, paddingLeft);
  const codePadding = gridded
    ? headingBaselinePadding(metrics.body.baseline, metrics.code.baseline, unit)
    : { top: unit / 2, bottom: unit / 2 };

  const baseCss = `${scope} {
  --templar-grid: ${px(unit)};
  --templar-baseline-position: ${px(baselinePosition)};
  --templar-image-border: ${imageBorder};
  --templar-page-width: ${px(style.page.width)};
  --templar-page-height: ${px(style.page.height)};
  --templar-page-gap: ${px(pageGap)};
  --templar-page-span: ${px(pageSpan)};
  --templar-page-scale: 1;
  --templar-body-line-height: ${px(bodyLineHeight)};
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
  ${paged ? '' : `${pattern}\n  background-color: ${paperColor};`}
  box-sizing: border-box;
  margin-inline: auto;
  max-width: ${paged ? 'none' : px(style.layout.maxWidth)};
  min-height: ${paged ? `var(--templar-canvas-height, ${px(style.page.height)})` : '100%'};
  padding: ${px(style.layout.paddingTop)} ${paddingRight} ${px(style.layout.paddingBottom)} ${paddingLeft};
  position: relative;
  width: ${paged ? px(style.page.width) : '100%'};
  zoom: ${paged ? 'var(--templar-page-scale)' : '1'};
}

${paged ? `${scope} .templar-page-content {
  isolation: isolate;
}

${scope} .templar-page-content::before {
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

${scope} .templar-page :is(p, ul, ol, blockquote, pre, table) {
  margin-block: 0 ${px(blockSpacing)} !important;
}

${scope} .templar-page .cm-content > :is(
  .HyperMD-paragraph:not(.HyperMD-header):not(:has(+ .HyperMD-paragraph:not(.HyperMD-header))),
  .HyperMD-list-line:not(:has(+ .HyperMD-list-line)),
  .HyperMD-quote:not(:has(+ .HyperMD-quote)),
  .HyperMD-codeblock:not(:has(+ .HyperMD-codeblock)),
  .cm-table-widget
) {
  margin-block: 0 ${px(blockSpacing)} !important;
}

${headingRule(scope, 'h1', style.headings.h1, metrics.h1, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h2', style.headings.h2, metrics.h2, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h3', style.headings.h3, metrics.h3, metrics.body.baseline, unit, gridded)}

${headingRule(scope, 'h4', style.headings.h4, metrics.h4, metrics.body.baseline, unit, gridded)}

${scope} .templar-page a {
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

${scope} .templar-page blockquote {
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

${scope} .templar-page table,
${scope} .templar-page :is(th, td) {
  border-color: ${safeValue(style.blocks.tableBorder, 'currentColor')};
}

${scope} .templar-page th {
  background: ${safeValue(style.blocks.tableHeaderBackground, 'transparent')};
}

${scope} .templar-blank-line-spacer {
  height: calc(var(--templar-body-line-height) * var(--templar-blank-lines, 1));
  margin: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  pointer-events: none;
}

${scope} .templar-page input[type="checkbox"] {
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
  filter: sepia(${String(style.images.sepia)}) grayscale(${String(style.images.grayscale)}) saturate(${String(style.images.saturation)}) contrast(${String(style.images.contrast)});
  margin-block: ${px(style.images.topSpacing)} calc(${px(imageBottom)} + var(--templar-image-snap, 0px));
  margin-inline: auto;
  max-height: ${paged ? px(printableHeight) : 'none'};
  max-width: ${String(style.images.maxWidth)}%;
  object-fit: contain;
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

  const custom = compileCustomCss(style.css, scope, scopeId);
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
  return {
    css: `${baseCss}\n\n${custom.css}\n\n${fixedCanvasGuard}\n\n${pageBreakGuard}`,
    issues: custom.issues,
  };
}
