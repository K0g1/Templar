import type { ImageFrame, TemplarNoteStyle } from '../../types';
import { round } from '../../utils/value';
import type { StyleCompilerContext } from './types';
import { px, safeValue } from './paper';

function frameAdjustments(frame: ImageFrame): string {
  switch (frame) {
    case 'none':
      return '';
    case 'thin':
    case 'technical':
      return 'background: transparent;';
    case 'photo':
    case 'polaroid':
    case 'scrapbook':
      return 'background: var(--templar-image-border);';
    case 'rounded':
      return 'overflow: hidden;';
    case 'dark':
      return 'background: #2b2724;';
    case 'vintage':
      return 'background: #f0e2c5;';
  }
}
function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const cleaned = hex.replace('#', '');
  const full =
    cleaned.length === 3 || cleaned.length === 4
      ? cleaned
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : cleaned;
  const match = /^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(full);
  if (!match) {
    return null;
  }
  const r = parseInt(match[1] ?? '', 16) / 255;
  const g = parseInt(match[2] ?? '', 16) / 255;
  const b = parseInt(match[3] ?? '', 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) {
    return { h: 0, s: 0, l: l * 100 };
  }
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === r) {
    h = (g - b) / d + (g < b ? 6 : 0);
  } else if (max === g) {
    h = (b - r) / d + 2;
  } else {
    h = (r - g) / d + 4;
  }
  return { h: h * 60, s: s * 100, l: l * 100 };
}

function duotoneFilter(hex: string): string {
  const target = hexToHsl(hex);
  if (!target) {
    return '';
  }
  // A full sepia pass lands near hsl(38, 50%, 50%); rotate and rescale the
  // channel percentages toward the requested color for a believable duotone.
  const hue = round(target.h - 38);
  const saturation = round(target.s / 50, 2);
  const lightness = round(target.l / 50, 2);
  return `grayscale(1) sepia(1) hue-rotate(${String(hue)}deg) saturate(${String(saturation)}) brightness(${String(lightness)})`;
}

function imageFilter(style: TemplarNoteStyle): string {
  const legacy = `sepia(${String(style.images.sepia)}) grayscale(${String(style.images.grayscale)}) saturate(${String(style.images.saturation)}) contrast(${String(style.images.contrast)})`;
  if (style.images.duotone === 'none') {
    return legacy;
  }
  const duotone = duotoneFilter(style.images.duotone);
  return duotone ? `${duotone} ${legacy}` : legacy;
}


export function compileImages(context: StyleCompilerContext): string {
  const { style, scope, paged, printableHeight, imageBorder } = context;
  const borderBottom = Math.max(style.images.borderWidth, style.images.bottomBorderWidth);
  return `${scope} .templar-page img {
  ${frameAdjustments(style.images.frame)}
  border-color: ${imageBorder};
  border-style: solid;
  border-width: ${px(style.images.borderWidth)} ${px(style.images.borderWidth)} ${px(borderBottom)};
  border-radius: ${px(style.images.cornerRadius)};
  box-shadow: ${safeValue(style.images.shadow, 'none')};
  box-sizing: border-box;
  display: block;
  filter: ${imageFilter(style)};
  float: ${style.images.float};
  margin-block: ${px(style.images.topSpacing)} calc(${px(style.images.bottomSpacing)} + var(--templar-image-snap, 0px));
  margin-inline: ${style.images.float === 'left' ? '0 1em 0 0' : style.images.float === 'right' ? '0 0 0 1em' : 'auto'};
  max-height: ${paged ? px(printableHeight) : 'none'};
  max-width: ${String(style.images.maxWidth)}%;
  object-fit: ${style.images.objectFit};
  opacity: ${String(style.images.opacity)};
  transform: rotate(${String(style.images.rotation)}deg);
}

${scope} .templar-page .metadata-container [data-property-key="templar"] {
  display: none;
}

${scope} .templar-page .metadata-container:not(:has([data-property-key]:not([data-property-key="templar"]))) {
  display: none;
}`;
}
