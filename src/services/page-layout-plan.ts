import type { TemplarNoteStyle } from '../types';

export interface PaginationMeasurement {
  element: HTMLElement;
  naturalTop: number;
  height: number;
  marginEnd: number;
  marginTop: string;
}

export interface PaginationBreakPlan {
  element: HTMLElement;
  originalMarginTop: string;
  breakOffset: number;
}

export interface PaginationPlan {
  breaks: PaginationBreakPlan[];
  canvasHeight: number;
}

export interface PaginationPlanOptions {
  pageGapOverride?: number;
  geometryScale: number;
}

/**
 * Computes pagination from one immutable geometry snapshot. DOM reads and
 * writes deliberately stay outside this function so the browser cannot be
 * forced into a read/write/read layout cycle for every candidate.
 */
export function planPagination(
  measurements: readonly PaginationMeasurement[],
  style: TemplarNoteStyle,
  options: PaginationPlanOptions,
): PaginationPlan {
  const gridded = style.baseline.enabled && style.baseline.mode !== 'free';
  const pageGap = options.pageGapOverride ?? (gridded
    ? alignedPageGapPure(style.page.height, style.page.gap, style.baseline.unit)
    : style.page.gap);
  const pageSpan = style.page.height + pageGap;
  const usableHeight = Math.max(
    style.baseline.unit,
    style.page.height - style.layout.paddingTop - style.layout.paddingBottom,
  );
  const geometryScale = options.geometryScale > 0 && Number.isFinite(options.geometryScale)
    ? options.geometryScale
    : 1;
  let cumulativeBreakShift = 0;
  let contentBottom = style.layout.paddingTop;
  const breaks: PaginationBreakPlan[] = [];

  for (const measurement of measurements) {
    const top = measurement.naturalTop / geometryScale + cumulativeBreakShift;
    const height = measurement.height / geometryScale;
    if (height <= 0) continue;
    const positionInPage = ((top % pageSpan) + pageSpan) % pageSpan;
    const crossesBottom = positionInPage + height > style.page.height - style.layout.paddingBottom;
    const startsInGap = positionInPage >= style.page.height;
    const overTallAwayFromTop = height > usableHeight &&
      Math.abs(positionInPage - style.layout.paddingTop) > 1;
    const shouldMove = startsInGap || (height > usableHeight ? overTallAwayFromTop : crossesBottom);
    if (shouldMove) {
      const nextPage = Math.floor(top / pageSpan) + 1;
      const nextTop = nextPage * pageSpan + style.layout.paddingTop;
      const breakOffset = Math.max(0, nextTop - top);
      breaks.push({
        element: measurement.element,
        originalMarginTop: measurement.marginTop,
        breakOffset,
      });
      cumulativeBreakShift += breakOffset;
    }
    contentBottom = Math.max(contentBottom, top + height + measurement.marginEnd / geometryScale);
  }

  contentBottom += style.layout.paddingBottom;
  const finalPageIndex = Math.floor(Math.max(0, contentBottom - 1) / pageSpan);
  return {
    breaks,
    canvasHeight: finalPageIndex * pageSpan + style.page.height,
  };
}

function alignedPageGapPure(pageHeight: number, configuredGap: number, unit: number): number {
  const raw = Math.max(0, configuredGap);
  if (unit <= 0 || !Number.isFinite(unit)) return raw;
  const remainder = (pageHeight + raw) % unit;
  return remainder === 0 ? raw : raw + unit - remainder;
}
