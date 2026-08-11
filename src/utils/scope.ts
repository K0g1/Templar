/** Stable, collision-free renderer scope for one leaf within a plugin run. */
export function leafScopeValue(sequence: number): string {
  return `templar-leaf-${Math.max(0, Math.trunc(sequence)).toString(36)}`;
}
