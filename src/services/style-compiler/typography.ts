export function fontDeclaration(family: string, size: number, weight: number): string {
  return `font-family: ${family}; font-size: ${String(size)}px; font-weight: ${String(weight)};`;
}
