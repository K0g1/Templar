import { describe, expect, it } from 'vitest';
import {
  distanceToGrid,
  exitTailToGrid,
  gridLine,
  gridPhase,
  isOnGrid,
  nearestGridDelta,
  nearestLegalGridDelta,
  nextGridDelta,
  type GridLattice,
} from '../src/services/rendering/baseline-grid/math';

function lattice(unit: number, origin: number, tolerance = 0.4): GridLattice {
  return { unit, origin, tolerance };
}

describe('absolute baseline-grid math', () => {
  it('normalizes phase and distance for fractional origins and positions', () => {
    const grid = lattice(30, 7.25);
    expect(gridPhase(7.25, grid)).toBeCloseTo(0);
    expect(gridPhase(37.25, grid)).toBeCloseTo(0);
    expect(gridPhase(-22.75, grid)).toBeCloseTo(0);
    expect(gridPhase(24.55, grid)).toBeCloseTo(17.3);
    expect(distanceToGrid(24.55, grid)).toBeCloseTo(12.7);
    expect(isOnGrid(37.75, grid)).toBe(false);
    expect(isOnGrid(37.55, grid)).toBe(true);
  });

  it('chooses the closest row, including an upward correction', () => {
    const grid = lattice(30, 0);
    expect(nearestGridDelta(44, grid)).toBe(-14);
    expect(nearestGridDelta(46, grid)).toBe(14);
    // Ties use the next row, which is deterministic and avoids overlap when
    // a caller has not supplied an occupied boundary yet.
    expect(nearestGridDelta(45, grid)).toBe(15);
    expect(nextGridDelta(44, grid)).toBe(16);
    expect(nextGridDelta(30.2, grid)).toBe(0);
  });

  it('chooses an upward row only when the nearest row is legal', () => {
    const grid = lattice(30, 0);
    // Row 30 is nearest and remains after the occupied boundary.
    expect(nearestLegalGridDelta(44, 29, grid)).toBe(-14);
    // Row 30 would overlap the occupied content, so row 60 is required.
    expect(nearestLegalGridDelta(44, 35, grid)).toBe(16);
    // A natural gap can be negative, but never below the occupied boundary.
    expect(nearestLegalGridDelta(44, 45, grid)).toBe(16);
    expect(44 + nearestLegalGridDelta(44, 45, grid)).toBeGreaterThanOrEqual(45);
  });

  it('computes block tails from absolute bottom phase rather than height phase', () => {
    const grid = lattice(30, 7.25);
    const bottom = grid.origin + (4 * grid.unit) + 17.3;
    const tail = exitTailToGrid(bottom, grid);
    expect(tail).toBeCloseTo(12.7);
    expect(isOnGrid(bottom + tail, grid)).toBe(true);
    expect(exitTailToGrid(gridLine(12, grid), grid)).toBe(0);
  });

  it('handles every unit from 12 through 96 with fractional origins', () => {
    for (let unit = 12; unit <= 96; unit += 1) {
      for (const origin of [0, 0.1, 7.25, 21.6, 29.999]) {
        const grid = lattice(unit, origin);
        for (const row of [-10, -1, 0, 1, 37, 100]) {
          expect(isOnGrid(gridLine(row, grid), grid), `${unit}/${origin}/${row}`).toBe(true);
        }
        const position = origin + unit * 4 + unit * 0.37 + 0.123;
        const delta = nearestGridDelta(position, grid);
        expect(isOnGrid(position + delta, grid), `${unit}/${origin}`).toBe(true);
        const tail = exitTailToGrid(position, grid);
        expect(isOnGrid(position + tail, grid), `${unit}/${origin}/tail`).toBe(true);
      }
    }
  });

  it('does not accumulate phase drift through a deterministic 10,000-block chain', () => {
    let seed = 0x1a2b3c4d;
    const random = (): number => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 0x1_0000_0000;
    };
    const samples = new Map<number, number>();

    for (let unit = 12; unit <= 96; unit += 1) {
      const grid = lattice(unit, 21.6 + (unit % 7) * 0.13);
      let occupiedBottom = grid.origin;
      let maxError = 0;
      for (let index = 1; index <= 10_000; index += 1) {
        const awkwardHeight = [137.3, 201.75, 413.2, 600.05][index % 4]!;
        const naturalGap = (random() - 0.5) * unit * 1.8;
        const naturalBaseline = occupiedBottom + naturalGap + (random() * unit * 0.35);
        const baselineDelta = nearestLegalGridDelta(naturalBaseline, occupiedBottom, grid);
        const baseline = naturalBaseline + baselineDelta;
        if (!isOnGrid(baseline, grid)) throw new Error(`${unit}/${index}/baseline`);
        if (baseline < occupiedBottom - grid.tolerance) throw new Error(`${unit}/${index}/overlap`);

        const naturalBottom = baseline + awkwardHeight + (random() - 0.5) * 0.7;
        const tail = exitTailToGrid(naturalBottom, grid);
        occupiedBottom = naturalBottom + tail;
        const error = distanceToGrid(occupiedBottom, grid);
        maxError = Math.max(maxError, error);
        if (error > grid.tolerance + 1e-9) throw new Error(`${unit}/${index}/exit`);
        if (index === 10 || index === 100 || index === 1_000 || index === 10_000) {
          samples.set(index, error);
        }
      }
      expect(maxError).toBeLessThanOrEqual(grid.tolerance + 1e-9);
      expect(samples.get(10_000)!).toBeLessThanOrEqual(samples.get(10)! + grid.tolerance);
    }
    expect(samples.get(10_000)).toBeDefined();
  }, 30_000);

  it('keeps bounded negative natural gaps from producing overlap', () => {
    const grid = lattice(29, 0.1);
    let occupied = gridLine(8, grid);
    for (const gap of [-28.9, -14.4, -0.1, 0, 0.2, 4.8]) {
      const desired = occupied + gap;
      const corrected = desired + nearestLegalGridDelta(desired, occupied, grid);
      expect(corrected).toBeGreaterThanOrEqual(occupied - grid.tolerance);
      expect(isOnGrid(corrected, grid)).toBe(true);
      occupied = corrected + 29.4;
      occupied += exitTailToGrid(occupied, grid);
      expect(isOnGrid(occupied, grid)).toBe(true);
    }
  });
});
