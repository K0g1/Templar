import { TEMPLAR_CONTENT_CLASS, TEMPLAR_PAGE_CLASS } from '../constants';
import type { FontMetrics } from '../types';
import { measuredGeometryScale, positiveModulo } from '../utils/grid';
import type { PageMetricSet } from './style-compiler';

export interface BaselineDiagnosticFailure {
  kind: 'phase' | 'height';
  tag: string;
  className: string;
  text: string;
  value: number;
  expected: number;
}

export interface BaselineDiagnosticReport {
  unit: number;
  pagesChecked: number;
  textChecked: number;
  blocksChecked: number;
  failures: BaselineDiagnosticFailure[];
}

const READING_NON_RHYTHMIC_ANCESTORS = [
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

const TEXT_SELECTOR = 'h1, h2, h3, h4, h5, h6, p, li, pre > code, .cm-content > .cm-line';
const RHYTHMIC_BLOCK_SELECTOR = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'li', 'ul', 'ol', 'blockquote', 'pre',
  'table', 'hr', '.callout', '.mermaid', '.internal-embed', '.file-embed',
  '.templar-grid-snap-block', '.cm-content > .cm-line',
].join(',');

function parsePixels(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function visibleText(element: HTMLElement): boolean {
  return element.getBoundingClientRect().height > 0 && Boolean(element.textContent?.trim());
}

function metricForElement(element: HTMLElement, metrics: PageMetricSet): FontMetrics {
  for (const level of [1, 2, 3, 4, 5, 6] as const) {
    if (element.tagName === `H${String(level)}` || element.hasClass(`HyperMD-header-${String(level)}`)) {
      return metrics[`h${String(level)}` as keyof Pick<
        PageMetricSet,
        'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      >];
    }
  }
  if (element.tagName === 'CODE' || element.hasClass('HyperMD-codeblock') || element.closest('pre')) {
    return metrics.code;
  }
  return metrics.body;
}

function deviation(value: number, unit: number): number {
  const phase = positiveModulo(value, unit);
  return Math.min(phase, unit - phase);
}

function textOf(element: HTMLElement): string {
  return (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 96);
}

function failure(
  element: HTMLElement,
  kind: BaselineDiagnosticFailure['kind'],
  value: number,
  expected: number,
): BaselineDiagnosticFailure {
  return {
    kind,
    tag: element.tagName.toLowerCase(),
    className: element.className,
    text: textOf(element),
    value,
    expected,
  };
}

function layoutHeight(element: HTMLElement, scale: number): number {
  if (element.hasClass('cm-line')) {
    return element.getBoundingClientRect().height / scale;
  }
  return element.offsetHeight > 0
    ? element.offsetHeight
    : element.getBoundingClientRect().height / scale;
}

/** Checks the currently rendered Obsidian page roots against Templar's grid. */
export function diagnoseBaselineAlignment(
  contentEl: HTMLElement,
  metrics: PageMetricSet,
  tolerance = 0.4,
): BaselineDiagnosticReport {
  const pageRoots = [...contentEl.querySelectorAll<HTMLElement>(`.${TEMPLAR_PAGE_CLASS}`)]
    .filter((element) => element.getBoundingClientRect().width > 0);
  const firstPage = pageRoots[0];
  const unit = parsePixels(
    firstPage?.ownerDocument.defaultView?.getComputedStyle(firstPage).getPropertyValue('--templar-grid') ?? '',
  );
  const report: BaselineDiagnosticReport = {
    unit,
    pagesChecked: 0,
    textChecked: 0,
    blocksChecked: 0,
    failures: [],
  };
  if (unit <= 0) return report;

  for (const pageRoot of pageRoots) {
    const pageContent = pageRoot.querySelector<HTMLElement>(`:scope > .${TEMPLAR_CONTENT_CLASS}`);
    if (!pageContent || pageContent.getBoundingClientRect().width <= 0) continue;
    report.pagesChecked += 1;
    const view = pageRoot.ownerDocument.defaultView;
    if (!view) continue;
    const contentRect = pageContent.getBoundingClientRect();
    const contentStyle = view.getComputedStyle(pageContent);
    const origin = parsePixels(contentStyle.getPropertyValue('--templar-paper-baseline-position'));
    const horizontalScale = measuredGeometryScale(contentRect.width, pageContent.offsetWidth, 1);
    const scale = measuredGeometryScale(contentRect.height, pageContent.offsetHeight, horizontalScale);
    const textCandidates = [...pageContent.querySelectorAll<HTMLElement>(TEXT_SELECTOR)]
      .filter((element) => visibleText(element))
      .filter((element) => !element.hasClass('HyperMD-frontmatter'))
      .filter((element) => {
        const excludedAncestor = element.closest(READING_NON_RHYTHMIC_ANCESTORS);
        return !excludedAncestor || excludedAncestor === element;
      });
    for (const element of textCandidates) {
      const rect = element.getBoundingClientRect();
      const style = view.getComputedStyle(element);
      const metric = metricForElement(element, metrics);
      const phase = deviation(
        (rect.top - contentRect.top) / scale +
          parsePixels(style.paddingTop) +
          parsePixels(style.borderTopWidth) +
          metric.baseline - origin,
        unit,
      );
      report.textChecked += 1;
      if (phase > tolerance) report.failures.push(failure(element, 'phase', phase, 0));
      if (
        ['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI'].includes(element.tagName) ||
        element.hasClass('cm-line')
      ) {
        const footprint = layoutHeight(element, scale) + (element.hasClass('cm-line')
          ? parsePixels(style.marginTop) + parsePixels(style.marginBottom)
          : 0);
        const remainder = deviation(footprint, unit);
        if (remainder > tolerance) report.failures.push(failure(element, 'height', remainder, 0));
      }
    }

    const blockCandidates = [...pageContent.querySelectorAll<HTMLElement>(RHYTHMIC_BLOCK_SELECTOR)]
      .filter((element) => element.getBoundingClientRect().height > 0)
      .filter((element) => {
        const owner = element.closest<HTMLElement>('.templar-grid-snap-block');
        return !owner || owner === element;
      });
    for (const element of blockCandidates) {
      report.blocksChecked += 1;
      const style = view.getComputedStyle(element);
      const footprint = layoutHeight(element, scale) +
        parsePixels(style.marginTop) + parsePixels(style.marginBottom);
      const remainder = deviation(footprint, unit);
      if (remainder > tolerance) report.failures.push(failure(element, 'height', remainder, 0));
    }
  }
  return report;
}

export function formatBaselineDiagnostic(report: BaselineDiagnosticReport): string {
  if (report.unit <= 0) return 'Ruled-line diagnostic unavailable: the active page is not gridded.';
  const status = report.failures.length === 0 ? 'PASS' : 'FAIL';
  return `Ruled-line check ${status}: ${String(report.textChecked)} text / ${String(report.blocksChecked)} blocks checked (${String(report.failures.length)} issues).`;
}
