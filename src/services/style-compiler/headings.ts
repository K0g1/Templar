import type { FontMetrics, HeadingLevelStyle } from '../../types';
import { fitToGrid, headingBaselinePadding } from '../../utils/grid';
import type { StyleCompilerContext } from './types';
import { px, safeValue } from './paper';

export function horizontalPadding(value: number, side: 'left' | 'right', paged: boolean): string {
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


export function compileHeadings(context: StyleCompilerContext): string {
  const { style, scope, metrics, unit, gridded } = context;
  const entries: Array<['h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6', HeadingLevelStyle, FontMetrics]> = [
    ['h1', style.headings.h1, metrics.h1],
    ['h2', style.headings.h2, metrics.h2],
    ['h3', style.headings.h3, metrics.h3],
    ['h4', style.headings.h4, metrics.h4],
    ['h5', style.headings.h5, metrics.h5],
    ['h6', style.headings.h6, metrics.h6],
  ];
  return entries.map(([level, heading, metric]) => headingRule(
    scope, level, heading, metric, metrics.body.baseline, unit, gridded,
  )).join('\n\n');
}
