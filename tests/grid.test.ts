import { describe, expect, it } from 'vitest';
import {
  alignedPageGap,
  blockSpacingForMode,
  fitToGrid,
  gridCompensation,
  headingBaselinePadding,
  imageGridCompensation,
  measuredGeometryScale,
  naturalOuterFootprint,
} from '../src/utils/grid';

describe('baseline grid math', () => {
  it('fits element heights to the next whole grid unit', () => {
    expect(fitToGrid(47, 30)).toBe(60);
    expect(fitToGrid(60, 30)).toBe(60);
    expect(fitToGrid(0, 30)).toBe(0);
  });

  it('keeps every gridded block exit on a whole grid unit', () => {
    expect(blockSpacingForMode('strict', 30, 30)).toBe(30);
    expect(blockSpacingForMode('balanced', 24, 24)).toBe(0);
    expect(blockSpacingForMode('free', 30, 24)).toBeCloseTo(15.6);
  });

  it('adds complementary heading padding without changing the grid multiple', () => {
    const padding = headingBaselinePadding(21, 34, 30);
    expect(padding).toEqual({ top: 17, bottom: 13 });
    expect((padding.top + padding.bottom) % 30).toBe(0);

    const expandedFontPadding = headingBaselinePadding(21, 23.4, 30, 31.2);
    expect(expandedFontPadding.top).toBeCloseTo(27.6);
    expect(expandedFontPadding.bottom).toBeCloseTo(1.2);
    expect(
      (31.2 + expandedFontPadding.top + expandedFontPadding.bottom) % 30,
    ).toBeCloseTo(0);
  });

  it('returns image compensation that restores the next baseline', () => {
    expect(imageGridCompensation(413, 30)).toBe(7);
    expect(imageGridCompensation(420, 30)).toBe(0);
    for (const unit of [24, 26, 28, 29, 30]) {
      const borderBox = 413;
      const outerFootprint = borderBox + 30 + 30;
      const correction = imageGridCompensation(outerFootprint, unit);
      expect((outerFootprint + correction) % unit, String(unit)).toBe(0);
    }
  });

  it('snaps variable renderer heights without reducing their content box', () => {
    expect(gridCompensation(137, 30)).toBe(13);
    expect(gridCompensation(180, 30)).toBe(0);
    expect(gridCompensation(180.001, 30)).toBe(0);
    expect(gridCompensation(179.999, 30)).toBe(0);
    expect(gridCompensation(137, 0)).toBe(0);
    expect(137 + gridCompensation(137, 30)).toBe(150);
  });

  it('measures the complete natural footprint without observer feedback', () => {
    expect(naturalOuterFootprint(167, 10, 13, 17, true)).toBe(173);
    expect(naturalOuterFootprint(150, 10, 13, 17, false)).toBe(173);
    expect(gridCompensation(173, 30)).toBe(7);
  });

  it('aligns page spans so ruled baselines reset identically on every sheet', () => {
    const gap = alignedPageGap(1123, 32, 30);
    expect((1123 + gap) % 30).toBe(0);
    expect(gap).toBeGreaterThanOrEqual(32);
  });

  it('normalizes zoom geometry from Chromium and older WebKit', () => {
    expect(measuredGeometryScale(317.6, 794, 0.4)).toBeCloseTo(0.4);
    expect(measuredGeometryScale(794, 794, 0.4)).toBe(1);
    expect(measuredGeometryScale(0, 794, 0.4)).toBe(0.4);
  });
});
