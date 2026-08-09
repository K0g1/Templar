import type { TemplarTemplate } from '../types';

interface RgbColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

interface ColorLayer {
  background: string;
  underlay?: string;
}

function parseColor(value: string): RgbColor | null {
  const color = value.trim();
  const hex = /^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i.exec(color)?.[1];
  if (hex) {
    const expanded = hex.length === 3
      ? [...hex].map((character) => `${character}${character}`).join('')
      : hex;
    return {
      red: Number.parseInt(expanded.slice(0, 2), 16),
      green: Number.parseInt(expanded.slice(2, 4), 16),
      blue: Number.parseInt(expanded.slice(4, 6), 16),
      alpha: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1,
    };
  }
  const functional = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)$/i.exec(color);
  if (!functional) {
    return null;
  }
  return {
    red: Number(functional[1]),
    green: Number(functional[2]),
    blue: Number(functional[3]),
    alpha: functional[4] === undefined ? 1 : Number(functional[4]),
  };
}

function composite(foreground: RgbColor, background: RgbColor): RgbColor {
  return {
    red: foreground.red * foreground.alpha + background.red * (1 - foreground.alpha),
    green: foreground.green * foreground.alpha + background.green * (1 - foreground.alpha),
    blue: foreground.blue * foreground.alpha + background.blue * (1 - foreground.alpha),
    alpha: 1,
  };
}

function luminance(color: RgbColor): number {
  const channel = (value: number): number => {
    const normalized = value / 255;
    return normalized <= 0.04045
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };
  return channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722;
}

export function contrastRatio(
  foreground: string,
  background: string,
  underlay = '#ffffff',
): number {
  const foregroundColor = parseColor(foreground);
  const backgroundColor = parseColor(background);
  const underlayColor = parseColor(underlay);
  if (!foregroundColor || !backgroundColor || !underlayColor) {
    return 0;
  }
  const opaqueBackground = backgroundColor.alpha < 1
    ? composite(backgroundColor, underlayColor)
    : backgroundColor;
  const opaqueForeground = foregroundColor.alpha < 1
    ? composite(foregroundColor, opaqueBackground)
    : foregroundColor;
  const lighter = Math.max(luminance(opaqueForeground), luminance(opaqueBackground));
  const darker = Math.min(luminance(opaqueForeground), luminance(opaqueBackground));
  return (lighter + 0.05) / (darker + 0.05);
}

function mixColor(source: RgbColor, target: RgbColor, amount: number): RgbColor {
  return {
    red: source.red + (target.red - source.red) * amount,
    green: source.green + (target.green - source.green) * amount,
    blue: source.blue + (target.blue - source.blue) * amount,
    alpha: 1,
  };
}

function hexColor(color: RgbColor): string {
  const channel = (value: number): string => Math.round(value).toString(16).padStart(2, '0');
  return `#${channel(color.red)}${channel(color.green)}${channel(color.blue)}`;
}

function minimumContrast(color: string, layers: readonly ColorLayer[]): number {
  return Math.min(...layers.map((layer) => (
    contrastRatio(color, layer.background, layer.underlay)
  )));
}

function readableAcross(
  preferred: string,
  layers: readonly ColorLayer[],
  requiredContrast = 4.5,
): string {
  if (minimumContrast(preferred, layers) >= requiredContrast) {
    return preferred;
  }
  const source = parseColor(preferred);
  const dark = '#151719';
  const light = '#f7f8fa';
  const endpoint = minimumContrast(dark, layers) >= minimumContrast(light, layers) ? dark : light;
  const target = parseColor(endpoint);
  if (!source || !target) {
    return endpoint;
  }
  let low = 0;
  let high = 1;
  for (let iteration = 0; iteration < 20; iteration += 1) {
    const midpoint = (low + high) / 2;
    const candidate = hexColor(mixColor(source, target, midpoint));
    if (minimumContrast(candidate, layers) >= requiredContrast) {
      high = midpoint;
    } else {
      low = midpoint;
    }
  }
  return hexColor(mixColor(source, target, high));
}

export function readableColor(
  preferred: string,
  background: string,
  underlay = '#ffffff',
  requiredContrast = 4.5,
): string {
  return readableAcross(preferred, [{ background, underlay }], requiredContrast);
}

export function ensureReadableTemplate(template: TemplarTemplate): TemplarTemplate {
  const paper = template.paper.color;
  template.typography.textColor = readableAcross(
    template.typography.textColor,
    [
      { background: paper },
      { background: template.blocks.embedBackground, underlay: paper },
    ],
  );
  template.typography.mutedColor = readableColor(template.typography.mutedColor, paper);
  for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
    const heading = template.headings[level];
    const isLargeText = heading.weight >= 700 ? heading.size >= 18.66 : heading.size >= 24;
    heading.color = readableColor(
      heading.color,
      paper,
      '#ffffff',
      isLargeText ? 3 : 4.5,
    );
  }
  template.lists.markerColor = readableColor(template.lists.markerColor, paper, '#ffffff', 3);
  template.lists.indentGuideColor = readableColor(
    template.lists.indentGuideColor,
    paper,
    '#ffffff',
    3,
  );
  template.blocks.linkColor = readableColor(template.blocks.linkColor, paper);
  template.blocks.highlightTextColor = readableColor(
    template.blocks.highlightTextColor,
    template.blocks.highlightBackground,
    paper,
  );
  template.blocks.quoteTextColor = readableColor(
    template.blocks.quoteTextColor,
    template.blocks.quoteBackground,
    paper,
  );
  template.blocks.codeTextColor = readableColor(
    template.blocks.codeTextColor,
    template.blocks.codeBackground,
    paper,
  );
  template.blocks.calloutTextColor = readableColor(
    template.blocks.calloutTextColor,
    template.blocks.calloutBackground,
    paper,
  );
  template.blocks.calloutTitleColor = readableColor(
    template.blocks.calloutTitleColor,
    template.blocks.calloutBackground,
    paper,
  );
  template.blocks.calloutIconColor = readableColor(
    template.blocks.calloutIconColor,
    template.blocks.calloutBackground,
    paper,
  );
  template.blocks.checkboxAccent = readableColor(
    template.blocks.checkboxAccent,
    paper,
    '#ffffff',
    3,
  );
  template.blocks.tableTextColor = readableAcross(
    template.blocks.tableTextColor,
    [
      { background: paper },
      { background: template.blocks.tableStripeColor, underlay: paper },
    ],
  );
  template.blocks.tableHeaderTextColor = readableColor(
    template.blocks.tableHeaderTextColor,
    template.blocks.tableHeaderBackground,
    paper,
  );
  template.blocks.embedAccent = readableColor(
    template.blocks.embedAccent,
    template.blocks.embedBackground,
    paper,
  );
  for (const variant of Object.values(template.blocks.calloutVariants)) {
    const background = variant.background ?? template.blocks.calloutBackground;
    variant.textColor = readableColor(
      variant.textColor ?? template.blocks.calloutTextColor,
      background,
      paper,
    );
    variant.titleColor = readableColor(
      variant.titleColor ?? template.blocks.calloutTitleColor,
      background,
      paper,
    );
    variant.iconColor = readableColor(
      variant.iconColor ?? template.blocks.calloutIconColor,
      background,
      paper,
    );
    variant.accent = readableColor(
      variant.accent ?? template.blocks.calloutAccent,
      background,
      paper,
      3,
    );
  }
  return template;
}
