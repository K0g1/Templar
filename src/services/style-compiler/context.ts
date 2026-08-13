import {
  alignedPageGap,
  blockSpacingForMode,
  headingBaselinePadding,
} from '../../utils/grid';
import { escapeCssString } from './watermark';
import { horizontalPadding } from './headings';
import { patternDeclarations, safeValue } from './paper';
import type { PageMetricSet, StyleCompilerContext } from './types';
import type { TemplarNoteStyle } from '../../types';

export function createStyleCompilerContext(
  style: TemplarNoteStyle,
  scope: string,
  scopeId: string,
  metrics: PageMetricSet,
): StyleCompilerContext {
  const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
  const unit = style.baseline.unit;
  const bodyLineHeight = gridded
    ? unit
    : style.typography.bodyLineHeight > 0
      ? style.typography.bodyLineHeight
      : Math.max(style.typography.bodySize * 1.55, 22);
  const effectiveBaselineMode = gridded ? style.baseline.mode : 'free';
  const paged = style.page.mode === 'paged';
  const pageGap = gridded
    ? alignedPageGap(style.page.height, style.page.gap, unit)
    : style.page.gap;
  const paddingRight = horizontalPadding(style.layout.paddingRight, 'right', paged);
  const paddingLeft = horizontalPadding(style.layout.paddingLeft, 'left', paged);
  return {
    style,
    scope,
    scopeId,
    metrics,
    gridded,
    paged,
    unit,
    bodyLineHeight,
    blockSpacing: blockSpacingForMode(effectiveBaselineMode, unit, bodyLineHeight),
    baselinePosition: style.layout.paddingTop + metrics.body.baseline,
    pageGap,
    pageSpan: style.page.height + pageGap,
    printableHeight: Math.max(unit, style.page.height - style.layout.paddingTop - style.layout.paddingBottom),
    paddingLeft,
    paddingRight,
    paperPattern: patternDeclarations(
      style,
      'var(--templar-paper-baseline-position)',
      paddingLeft,
    ),
    codePadding: gridded
      ? headingBaselinePadding(metrics.body.baseline, metrics.code.baseline, unit, metrics.code.lineHeight)
      : { top: unit / 2, bottom: unit / 2 },
    bodyFont: safeValue(style.typography.bodyFont, 'Georgia, serif'),
    paperColor: safeValue(style.paper.color, '#fffdf7'),
    textColor: safeValue(style.typography.textColor, '#302e2b'),
    mutedColor: safeValue(style.typography.mutedColor, '#706c66'),
    imageBorder: safeValue(style.images.borderColor, '#ffffff'),
    watermarkText: escapeCssString(style.watermark.text),
  };
}
