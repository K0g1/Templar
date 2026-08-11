import { round } from '../../utils/value';

export function safeValue(value: string, fallback: string): string {
  const hasControl = Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (
    !value.trim() ||
    hasControl ||
    /[;{}<>]/.test(value) ||
    /(?:url|expression)\s*\(/i.test(value)
  ) {
    return fallback;
  }
  return value;
}

export function px(value: number): string {
  return `${String(round(value))}px`;
}

export function withOpacity(color: string, opacity: number): string {
  const clamped = Math.min(1, Math.max(0, opacity));
  if (clamped >= 1) return color;
  return `color-mix(in srgb, ${color} ${String(round(clamped * 100))}%, transparent)`;
}

export function paperColorDeclaration(color: string): string {
  return `background-color: ${color};`;
}

export function paperLayerList(layers: readonly string[]): string {
  return layers.join(', ');
}
