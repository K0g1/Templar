import type { TemplarNoteStyle } from '../types';

export function printPageSize(style: TemplarNoteStyle): string {
  if (style.page.mode === 'pageless') return 'auto';
  if (style.page.size === 'a4') return 'A4';
  if (style.page.size === 'letter') return 'Letter';
  return `${String(style.page.width / 96)}in ${String(style.page.height / 96)}in`;
}
