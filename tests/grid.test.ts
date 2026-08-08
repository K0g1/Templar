import { describe, expect, it } from 'vitest';
import {
  alignedPageGap,
  blockSpacingForMode,
  fitToGrid,
  headingBaselinePadding,
  imageGridCompensation,
  measuredGeometryScale,
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
  });

  it('returns image compensation that restores the next baseline', () => {
    expect(imageGridCompensation(413, 30)).toBe(7);
    expect(imageGridCompensation(420, 30)).toBe(0);
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
