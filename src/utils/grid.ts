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
): { top: number; bottom: number } {
  const top = positiveModulo(bodyBaseline - headingBaseline, gridUnit);
  const bottom = top === 0 ? 0 : gridUnit - top;
  return { top, bottom };
}

export function imageGridCompensation(height: number, gridUnit: number): number {
  return Math.max(0, fitToGrid(height, gridUnit) - height);
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
