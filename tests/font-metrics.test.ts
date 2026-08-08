import { describe, expect, it } from 'vitest';
import { baselineOffsetFromMarker } from '../src/services/font-metrics';

describe('font baseline measurement', () => {
  it('uses the marker bottom edge because the marker border box ends at the baseline', () => {
    expect(baselineOffsetFromMarker(100, 121, 30, 18)).toBe(21);
  });

  it('falls back to a stable typographic estimate when DOM geometry is unavailable', () => {
    expect(baselineOffsetFromMarker(100, Number.NaN, 30, 18)).toBe(21.48);
  });
});
