/**
 * Pure absolute-phase calculations for Templar's baseline grid.
 *
 * Positions passed to this module are CSS-pixel coordinates in one stable
 * page-content coordinate system.  The origin is never inferred from a
 * rendered child: it is compiled from page padding and the measured body
 * baseline.  Keeping that distinction here prevents a local correction from
 * becoming the phase of every following block.
 */

export interface GridLattice {
  /** Distance between ruled rows in CSS pixels. */
  unit: number;
  /** First legal grid line in the page-content coordinate system. */
  origin: number;
  /** Maximum acceptable phase error in CSS pixels. */
  tolerance: number;
}

function validUnit(lattice: GridLattice): number {
  return Number.isFinite(lattice.unit) && lattice.unit > 0 ? lattice.unit : 0;
}

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** Returns the normalized phase in [0, unit). */
export function gridPhase(position: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const origin = finite(lattice.origin, 0);
  const phase = (finite(position, origin) - origin) % unit;
  return phase < 0 ? phase + unit : phase;
}

/** Returns the shortest absolute distance from a position to the lattice. */
export function distanceToGrid(position: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const phase = gridPhase(position, lattice);
  return Math.min(phase, unit - phase);
}

/**
 * Returns the signed movement required to reach the nearest grid line.
 * A negative value is valid: callers that have an occupied lower boundary
 * must use nearestLegalGridDelta instead.
 */
export function nearestGridDelta(position: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const origin = finite(lattice.origin, 0);
  const current = finite(position, origin);
  const row = Math.round((current - origin) / unit);
  return origin + row * unit - current;
}

/**
 * Returns the non-negative movement to the next legal grid line.
 * Positions already within tolerance of a line return zero.
 */
export function nextGridDelta(position: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const origin = finite(lattice.origin, 0);
  const current = finite(position, origin);
  if (distanceToGrid(current, lattice) <= Math.max(0, lattice.tolerance)) {
    return 0;
  }
  const row = Math.ceil((current - origin) / unit);
  return Math.max(0, origin + row * unit - current);
}

/**
 * Snaps a desired position to the closest grid line that does not move above
 * minimumPosition.  This is the renderer's non-overlap rule: an upward snap
 * is allowed only when the resulting position is still at or below the
 * occupied boundary.  If the nearest row would overlap, the next row wins.
 */
export function nearestLegalGridDelta(
  position: number,
  minimumPosition: number,
  lattice: GridLattice,
): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const origin = finite(lattice.origin, 0);
  const current = finite(position, origin);
  const minimum = finite(minimumPosition, Number.NEGATIVE_INFINITY);
  const nearestRow = Math.round((current - origin) / unit);
  let target = origin + nearestRow * unit;
  if (target < minimum) {
    target += unit;
  }
  return target - current;
}

/**
 * Adds invisible trailing rhythm to a block so its absolute bottom returns
 * to the fixed lattice.  Natural height is intentionally not used here:
 * inherited phase errors are the bug this function is designed to remove.
 */
export function exitTailToGrid(blockBottom: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  if (unit <= 0) return 0;
  const distance = nextGridDelta(blockBottom, lattice);
  return distance <= Math.max(0, lattice.tolerance) ? 0 : distance;
}

/** Returns the absolute coordinate of a grid row. */
export function gridLine(row: number, lattice: GridLattice): number {
  const unit = validUnit(lattice);
  return unit <= 0 ? finite(lattice.origin, 0) : finite(lattice.origin, 0) + row * unit;
}

/** True when a position is within the lattice tolerance. */
export function isOnGrid(position: number, lattice: GridLattice): boolean {
  return distanceToGrid(position, lattice) <= Math.max(0, lattice.tolerance);
}
