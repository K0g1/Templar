import { gridCompensation } from '../../utils/grid';
import { round } from '../../utils/value';

/** Pure variable-block correction; the PageRenderer owns DOM observation. */
export function variableBlockSnapPixels(footprint: number, unit: number): number {
  return round(gridCompensation(footprint, unit));
}
