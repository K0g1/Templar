import type { FontMetrics } from '../types';
import { positiveModulo } from '../utils/grid';
import type { PageMetricSet } from './style-compiler';

export interface PaperOriginTarget {
  element: HTMLElement;
  metric: FontMetrics;
}

const NON_RHYTHMIC_READING_ANCESTORS = [
  '.callout',
  '.metadata-container',
  '.mermaid',
  '.mod-frontmatter',
  '.mod-header',
  '.mod-ui',
  '.templar-grid-snap-block',
  'table',
  'figure',
  'iframe',
  'object',
  'video',
  'audio',
  'canvas',
].join(',');

function hasVisibleText(element: HTMLElement): boolean {
  return element.getBoundingClientRect().height > 0 && Boolean(element.textContent?.trim());
}

function headingMetric(
  element: HTMLElement,
  metrics: PageMetricSet,
): FontMetrics | null {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (
      element.tagName === `H${String(level)}` ||
      element.hasClass(`HyperMD-header-${String(level)}`)
    ) {
      return metrics[`h${String(level)}` as keyof Pick<
        PageMetricSet,
        'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      >];
    }
  }
  return null;
}

function metricForElement(element: HTMLElement, metrics: PageMetricSet): FontMetrics {
  const heading = headingMetric(element, metrics);
  if (heading) {
    return heading;
  }
  if (
    element.tagName === 'CODE' ||
    element.hasClass('HyperMD-codeblock') ||
    element.closest('pre')
  ) {
    return metrics.code;
  }
  return metrics.body;
}

/**
 * Finds the first real CodeMirror source line whose baseline participates in
 * the document rhythm. Renderer widgets are skipped because their outer block
 * is snapped independently and their internal typography is intentionally
 * free-form.
 */
export function findEditorPaperOriginTarget(
  content: HTMLElement,
  metrics: PageMetricSet,
): PaperOriginTarget | null {
  const lines = content.querySelectorAll<HTMLElement>('.cm-content > .cm-line');
  for (const line of lines) {
    if (
      !hasVisibleText(line) ||
      line.hasClass('HyperMD-frontmatter') ||
      line.hasClass('HyperMD-hr') ||
      line.hasClass('HyperMD-table-row') ||
      line.hasClass('HyperMD-codeblock-begin') ||
      line.hasClass('HyperMD-codeblock-end') ||
      line.querySelector('.callout, .cm-callout, .cm-embed-block, .cm-table-widget')
    ) {
      continue;
    }
    return { element: line, metric: metricForElement(line, metrics) };
  }
  return null;
}

/** Finds the first Reading View text baseline outside variable renderer blocks. */
export function findReadingPaperOriginTarget(
  content: HTMLElement,
  metrics: PageMetricSet,
): PaperOriginTarget | null {
  const candidates = content.querySelectorAll<HTMLElement>(
    'h1, h2, h3, h4, h5, h6, p, li, pre > code',
  );
  for (const candidate of candidates) {
    if (
      !hasVisibleText(candidate) ||
      candidate.closest(NON_RHYTHMIC_READING_ANCESTORS)
    ) {
      continue;
    }
    return { element: candidate, metric: metricForElement(candidate, metrics) };
  }
  return null;
}

/**
 * Converts a measured DOM baseline into the repeating paper coordinate system.
 * Geometry is normalized for CSS zoom before taking the grid phase.
 */
export function measuredPaperOrigin(
  contentTop: number,
  targetTop: number,
  geometryScale: number,
  targetPaddingTop: number,
  targetBorderTop: number,
  metricBaseline: number,
  gridUnit: number,
): number {
  const scale = Number.isFinite(geometryScale) && geometryScale > 0
    ? geometryScale
    : 1;
  const targetOffset = (targetTop - contentTop) / scale;
  return positiveModulo(
    targetOffset + targetBorderTop + targetPaddingTop + metricBaseline,
    gridUnit,
  );
}
