import type { TemplarNoteStyle } from '../../types';
import { round } from '../../utils/value';

export function patternDeclarations(
  style: TemplarNoteStyle,
  baselineAnchor: string,
  inlineStart: string,
): string {
  const { paper, baseline: grid } = style;
  const unit = grid.unit;
  const tile = unit * paper.patternScale;
  const halfUnit = px(tile / 2);
  const dotPosition = `calc(${inlineStart} - ${halfUnit}) calc(${baselineAnchor} - ${halfUnit})`;
  const gridPosition = `${inlineStart} ${baselineAnchor}`;
  const patternColor = withOpacity(
    safeValue(paper.patternColor, 'rgba(80, 120, 160, 0.3)'),
    paper.patternOpacity,
  );
  const majorColor = withOpacity(
    safeValue(paper.majorPatternColor, 'rgba(60, 100, 140, 0.35)'),
    paper.patternOpacity,
  );
  const marginColor = safeValue(paper.marginColor, 'rgba(200, 80, 80, 0.55)');
  const marginOffset =
    style.page.mode === 'paged' ? px(paper.marginOffset) : `min(${px(paper.marginOffset)}, 15%)`;
  const marginStart = `calc(${marginOffset} - 0.75px)`;
  const marginEnd = `calc(${marginOffset} + 0.75px)`;
  const marginLayer = `linear-gradient(to right, transparent 0, transparent ${marginStart}, ${marginColor} ${marginStart}, ${marginColor} ${marginEnd}, transparent ${marginEnd})`;
  const mirroredStart = `calc(100% - ${marginOffset} - 0.75px)`;
  const mirroredEnd = `calc(100% - ${marginOffset} + 0.75px)`;
  const ledgerLayer = `linear-gradient(to right, transparent 0, transparent ${marginStart}, ${marginColor} ${marginStart}, ${marginColor} ${marginEnd}, transparent ${marginEnd}, transparent ${mirroredStart}, ${marginColor} ${mirroredStart}, ${marginColor} ${mirroredEnd}, transparent ${mirroredEnd})`;

  const serializeLayers = (
    layers: string[],
    sizes: string[],
    positions: string[],
    repeats: string[],
  ): string => {
    if (
      layers.length !== sizes.length ||
      layers.length !== positions.length ||
      layers.length !== repeats.length
    ) {
      throw new Error('Templar paper-pattern layer declarations are out of sync.');
    }
    return `background-image: ${layers.join(',\n    ')};
  background-size: ${sizes.join(', ')};
  background-position: ${positions.join(', ')};
  background-repeat: ${repeats.join(', ')};`;
  };

  const withMarginLayer = (
    layers: string[],
    sizes: string[],
    positions: string[],
    repeats: string[],
  ): void => {
    if (!paper.marginLine) {
      return;
    }
    layers.unshift(marginLayer);
    sizes.unshift('100% 100%');
    positions.unshift('0 0');
    repeats.unshift('no-repeat');
  };

  if (paper.pattern === 'ruled' || paper.pattern === 'ledger') {
    // The baseline is the top edge of the ink. The one-pixel rule extends
    // downward so ordinary glyph bottoms remain clear while descenders cross it.
    const ruling = `linear-gradient(to bottom, ${patternColor} 0, ${patternColor} 1px, transparent 1px, transparent 100%)`;
    const marginLayerForPattern = paper.pattern === 'ledger' ? ledgerLayer : marginLayer;
    const layers = paper.marginLine || paper.pattern === 'ledger'
      ? `${marginLayerForPattern}, ${ruling}`
      : ruling;
    if (paper.marginLine || paper.pattern === 'ledger') {
      return `background-image: ${layers};
  background-size: 100% 100%, 100% ${px(tile)};
  background-position: 0 0, 0 ${baselineAnchor};
  background-repeat: no-repeat, repeat;`;
    }
    return `background-image: ${ruling};
  background-size: 100% ${px(tile)};
  background-position: 0 ${baselineAnchor};
  background-repeat: repeat;`;
  }

  if (paper.pattern === 'dot-grid') {
    const dots = `radial-gradient(circle, ${patternColor} ${px(paper.dotRadius)}, transparent calc(${px(paper.dotRadius)} * 1.25))`;
    const layers = [dots];
    const sizes = [`${px(tile)} ${px(tile)}`];
    const positions = [dotPosition];
    const repeats = ['repeat'];
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.pattern === 'graph') {
    const major = tile * paper.graphMajorInterval;
    const layers = [
      `linear-gradient(${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(90deg, ${majorColor} 1.25px, transparent 1.25px)`,
      `linear-gradient(${patternColor} 1px, transparent 1px)`,
      `linear-gradient(90deg, ${patternColor} 1px, transparent 1px)`,
    ];
    const sizes = [
      `${px(major)} ${px(major)}`,
      `${px(major)} ${px(major)}`,
      `${px(tile)} ${px(tile)}`,
      `${px(tile)} ${px(tile)}`,
    ];
    const positions = [gridPosition, gridPosition, gridPosition, gridPosition];
    const repeats = ['repeat', 'repeat', 'repeat', 'repeat'];
    if (paper.marginLine) {
      layers.unshift(marginLayer);
      sizes.unshift('100% 100%');
      positions.unshift('0 0');
      repeats.unshift('no-repeat');
    }
    return `background-image: ${layers.join(',\n    ')};
  background-size: ${sizes.join(', ')};
  background-position: ${positions.join(', ')};
  background-repeat: ${repeats.join(', ')};`;
  }

  if (paper.pattern === 'diagonal' || paper.pattern === 'cross-hatch') {
    // A color stop at 1px only paints a corner of each tile. Centering the
    // stroke in the tile creates a continuous diagonal from edge to edge.
    const stroke = `linear-gradient(135deg, transparent calc(50% - 0.5px), ${patternColor} calc(50% - 0.5px), ${patternColor} calc(50% + 0.5px), transparent calc(50% + 0.5px))`;
    const counterStroke = `linear-gradient(45deg, transparent calc(50% - 0.5px), ${patternColor} calc(50% - 0.5px), ${patternColor} calc(50% + 0.5px), transparent calc(50% + 0.5px))`;
    const layers = paper.pattern === 'cross-hatch' ? [stroke, counterStroke] : [stroke];
    const sizes = layers.map(() => `${px(tile)} ${px(tile)}`);
    const positions = layers.map(() => gridPosition);
    const repeats = layers.map(() => 'repeat');
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.pattern === 'hex') {
    const hexWidth = tile * Math.sqrt(3);
    const hexHeight = tile * 2;
    const halfWidth = px(hexWidth / 2);
    const halfHeight = px(hexHeight / 2);
    const shiftedPosition = `calc(${inlineStart} + ${halfWidth}) calc(${baselineAnchor} + ${halfHeight})`;
    // Six interlocking edge layers form complete hexagons. Keeping every
    // layer explicit also prevents a margin layer from changing repeat rules.
    const hexLayers = [
      `linear-gradient(30deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(150deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(30deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(150deg, ${patternColor} 12%, transparent 12.5%, transparent 87%, ${patternColor} 87.5%)`,
      `linear-gradient(60deg, ${patternColor} 25%, transparent 25.5%, transparent 75%, ${patternColor} 75%)`,
      `linear-gradient(60deg, ${patternColor} 25%, transparent 25.5%, transparent 75%, ${patternColor} 75%)`,
    ];
    const hexSize = `${px(hexWidth)} ${px(hexHeight)}`;
    const hexSizes = hexLayers.map(() => hexSize);
    const hexPositions = [
      gridPosition,
      gridPosition,
      shiftedPosition,
      shiftedPosition,
      gridPosition,
      shiftedPosition,
    ];
    const hexRepeats = hexLayers.map(() => 'repeat');
    withMarginLayer(hexLayers, hexSizes, hexPositions, hexRepeats);
    return serializeLayers(hexLayers, hexSizes, hexPositions, hexRepeats);
  }

  if (paper.pattern === 'scallop') {
    const radius = tile / 2;
    const bump = `radial-gradient(circle at 50% 100%, transparent ${px(Math.max(0, radius - 0.75))}, ${patternColor} ${px(Math.max(0, radius - 0.5))}, ${patternColor} ${px(radius + 0.5)}, transparent ${px(radius + 0.75)})`;
    const layers = [bump, bump];
    const sizes = layers.map(() => `${px(tile)} ${px(tile)}`);
    const positions = [
      gridPosition,
      `calc(${inlineStart} + ${halfUnit}) calc(${baselineAnchor} + ${halfUnit})`,
    ];
    const repeats = layers.map(() => 'repeat');
    withMarginLayer(layers, sizes, positions, repeats);
    return serializeLayers(layers, sizes, positions, repeats);
  }

  if (paper.marginLine) {
    return `background-image: ${marginLayer};
  background-size: 100% 100%;
  background-repeat: no-repeat;`;
  }
  return 'background-image: none;';
}


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
