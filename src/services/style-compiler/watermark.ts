import { safeValue } from './paper';

export function watermarkSelector(): string {
  return '.page::after';
}

export function escapeCssString(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\0/g, '\\fffd ')
    .replace(/\r/g, '\\d ')
    .replace(/\n/g, '\\a ')
    .replace(/\f/g, '\\c ')
    .replace(/"/g, '\\"');
}

export function compileWatermark(context: import('./types').StyleCompilerContext): string {
  const { style, scope, paged, paperPattern, pageSpan, paperColor } = context;
  const color = safeValue(style.watermark.color, 'rgba(48, 46, 43, 0.1)');
  return `${scope} .templar-page-content::after {
  color: ${color};
  content: var(--templar-watermark, "");
  display: grid;
  font-size: ${String(style.watermark.size)}px;
  inset: 0;
  line-height: 1;
  opacity: ${String(style.watermark.opacity)};
  place-items: center;
  pointer-events: none;
  position: absolute;
  transform: rotate(${String(style.watermark.rotation)}deg);
  user-select: none;
  white-space: pre;
  z-index: -1;
}

${paged ? `${scope} .templar-page-content::before {
  ${paperPattern}
  -webkit-mask-image: repeating-linear-gradient(to bottom, #000 0, #000 ${String(style.page.height)}px, transparent ${String(style.page.height)}px, transparent ${String(pageSpan)}px);
  background-color: ${paperColor};
  content: "";
  filter: drop-shadow(0 3px 12px rgba(0, 0, 0, 0.16));
  inset: 0;
  mask-image: repeating-linear-gradient(to bottom, #000 0, #000 ${String(style.page.height)}px, transparent ${String(style.page.height)}px, transparent ${String(pageSpan)}px);
  pointer-events: none;
  position: absolute;
  z-index: -1;
}` : ''}`;
}
