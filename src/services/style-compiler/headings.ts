export function headingSelector(level: 1 | 2 | 3 | 4 | 5 | 6): string {
  return `h${String(level)}`;
}
