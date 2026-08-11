import type { BaselineMode } from '../types';

export function fitToGrid(requiredHeight: number, gridUnit: number): number {
  if (gridUnit <= 0) {
    return Math.max(0, requiredHeight);
  }
  return Math.ceil(Math.max(0, requiredHeight) / gridUnit) * gridUnit;
}

/**
 * Extra space after a rendered block.
 *
 * Gridded modes may only add whole grid units. A half-unit gap makes the next
 * paragraph baseline land between paper lines, even when its own line-height
 * is correct. Balanced mode stays compact with no extra row; strict mode keeps
 * one empty row between blocks.
 */
export function blockSpacingForMode(
  mode: BaselineMode,
  gridUnit: number,
  bodyLineHeight: number,
): number {
  if (mode === 'strict') {
    return gridUnit;
  }
  if (mode === 'balanced') {
    return 0;
  }
  return bodyLineHeight * 0.65;
}

export function positiveModulo(value: number, divisor: number): number {
  if (divisor <= 0) {
    return 0;
  }
  return ((value % divisor) + divisor) % divisor;
}

export function headingBaselinePadding(
  bodyBaseline: number,
  headingBaseline: number,
  gridUnit: number,
  renderedLineHeight = gridUnit,
): { top: number; bottom: number } {
  const top = positiveModulo(bodyBaseline - headingBaseline, gridUnit);
  const bottom = positiveModulo(-(Math.max(0, renderedLineHeight) + top), gridUnit);
  return { top, bottom };
}

export function gridCompensation(height: number, gridUnit: number): number {
  if (gridUnit <= 0) {
    return 0;
  }
  const remainder = positiveModulo(Math.max(0, height), gridUnit);
  // DOM geometry commonly carries sub-pixel noise (for example 120.00001px).
  // Treat measurements already on a grid boundary as exact so a rounding
  // artefact cannot add an almost-complete extra baseline row.
  const boundaryTolerance = Math.min(0.05, gridUnit / 1000);
  if (remainder <= boundaryTolerance || gridUnit - remainder <= boundaryTolerance) {
    return 0;
  }
  return gridUnit - remainder;
}

/** Backward-compatible name for the original image-only caller. */
export function imageGridCompensation(height: number, gridUnit: number): number {
  return gridCompensation(height, gridUnit);
}

export function naturalOuterFootprint(
  borderBoxHeight: number,
  marginStart: number,
  marginEnd: number,
  previousTail: number,
  tailContributesToBorderBox: boolean,
): number {
  return Math.max(
    0,
    borderBoxHeight - (tailContributesToBorderBox ? previousTail : 0) +
      Math.max(0, marginStart) +
      Math.max(0, marginEnd),
  );
}

export function alignedPageGap(pageHeight: number, requestedGap: number, gridUnit: number): number {
  if (gridUnit <= 0) {
    return requestedGap;
  }
  return requestedGap + positiveModulo(-(pageHeight + requestedGap), gridUnit);
}

/**
 * Measures whether DOM geometry reports CSS-zoomed or unzoomed lengths.
 * Older WebKit returns unzoomed client rects, while Chromium and newer WebKit
 * include the zoom. Pagination must normalize by what the engine reports.
 */
export function measuredGeometryScale(
  renderedWidth: number,
  fixedLayoutWidth: number,
  fallback: number,
): number {
  if (renderedWidth <= 0 || fixedLayoutWidth <= 0) {
    return fallback;
  }
  const measured = renderedWidth / fixedLayoutWidth;
  return Number.isFinite(measured) && measured > 0 ? measured : fallback;
}
