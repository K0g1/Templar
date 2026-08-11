import { imageGridCompensation } from '../../utils/grid';
import { round } from '../../utils/value';

/** Pure image-tail calculation kept separate from observer wiring. */
export function imageSnapPixels(footprint: number, unit: number): number {
  return round(imageGridCompensation(footprint, unit));
}
