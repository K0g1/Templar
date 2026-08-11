import { describe, expect, it } from 'vitest';
import { measuredPaperOrigin } from '../src/services/paper-origin';

describe('measured paper origin', () => {
  it('anchors a no-properties note to its actual first body baseline', () => {
    expect(measuredPaperOrigin(78.75, 138.75, 1, 0, 0, 21.6, 30)).toBeCloseTo(
      21.6,
    );
  });

  it('absorbs an arbitrary properties prefix without assuming its height', () => {
    expect(measuredPaperOrigin(78.75, 488.15, 1, 0, 0, 20.4, 30)).toBeCloseTo(
      9.8,
      1,
    );
  });

  it('includes heading padding and normalizes CSS zoom geometry', () => {
    expect(measuredPaperOrigin(40, 100, 0.5, 7.2, 0, 42.8, 30)).toBeCloseTo(
      20,
    );
  });

  it('falls back to unscaled geometry for invalid scale input', () => {
    expect(measuredPaperOrigin(10, 40, 0, 0, 0, 21, 30)).toBe(21);
  });
});
