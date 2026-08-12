import type { TemplarNoteStyle } from '../../types';
import { px, safeValue } from './paper';
import type { StyleCompilerContext } from './types';

function dividerDeclarations(style: TemplarNoteStyle): string {
  const color = safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)');
  const width = Math.max(style.blocks.dividerWidth, 1);
  switch (style.blocks.dividerStyle) {
    case 'dashed':
      return `border-block-start: ${px(width)} dashed ${color};`;
    case 'dotted':
      return `border-block-start: ${px(width)} dotted ${color};`;
    case 'double':
      return `border-block-start: ${px(Math.max(width, 3))} double ${color};`;
    case 'fade':
      return `border-block-start: ${px(width)} solid ${color};
  -webkit-mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);`;
    case 'solid':
    default:
      return `border-block-start: ${px(width)} solid ${color};`;
  }
}

function griddedDividerDeclarations(style: TemplarNoteStyle, unit: number): string {
  const color = safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)');
  const thickness = Math.max(1, Math.min(style.blocks.dividerWidth, unit / 3));
  const size = px(thickness);
  let background: string;
  switch (style.blocks.dividerStyle) {
    case 'dashed':
      background = `repeating-linear-gradient(to right, ${color} 0 12px, transparent 12px 20px) center / 100% ${size} no-repeat`;
      break;
    case 'dotted':
      background = `radial-gradient(circle closest-side, ${color} 90%, transparent) left center / ${px(thickness * 2.4)} ${size} repeat-x`;
      break;
    case 'double': {
      const stroke = Math.max(1, thickness / 3);
      const offset = Math.max(stroke, thickness / 3);
      background = `linear-gradient(${color}, ${color}) center calc(50% - ${px(offset)}) / 100% ${px(stroke)} no-repeat, linear-gradient(${color}, ${color}) center calc(50% + ${px(offset)}) / 100% ${px(stroke)} no-repeat`;
      break;
    }
    case 'fade':
      background = `linear-gradient(to right, transparent, ${color} 10%, ${color} 90%, transparent) center / 100% ${size} no-repeat`;
      break;
    case 'solid':
    default:
      background = `linear-gradient(${color}, ${color}) center / 100% ${size} no-repeat`;
      break;
  }
  return `background: ${background};
  border: 0 !important;
  box-sizing: border-box;
  height: ${px(unit)} !important;
  min-height: ${px(unit)} !important;
  margin-block: 0 !important;
  padding: 0 !important;`;
}

function calloutRules(style: TemplarNoteStyle, scope: string): string {
  const { blocks } = style;
  const accent = safeValue(blocks.calloutAccent, '#9fb8ca');
  const background = safeValue(blocks.calloutBackground, 'rgba(159, 184, 202, 0.12)');
  const textColor = safeValue(blocks.calloutTextColor, '#302e2b');
  const titleColor = safeValue(blocks.calloutTitleColor, '#302e2b');
  const iconColor = safeValue(blocks.calloutIconColor, '#9fb8ca');
  const base = `${scope} .templar-page :is(.callout, .cm-callout) {
  --callout-background: ${background};
  --callout-border-color: ${accent};
  --callout-border-width: ${px(blocks.calloutBorderWidth)};
  background-color: ${background};
  border-color: ${accent};
  border-radius: ${px(blocks.calloutRadius)};
  /* Obsidian themes may blend callouts against the workspace background.
     Templar supplies an isolated paper surface and a complete callout palette,
     so theme blend modes can erase otherwise valid dark-on-light callouts. */
  mix-blend-mode: normal;
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-content {
  color: ${textColor};
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-title {
  color: ${titleColor};
}

${scope} .templar-page :is(.callout, .cm-callout) .callout-icon {
  color: ${iconColor};
}`;
  const variantRules: string[] = [];
  for (const [type, variant] of Object.entries(blocks.calloutVariants)) {
    const containerDeclarations: string[] = [];
    if (variant.accent !== undefined) {
      const value = safeValue(variant.accent, accent);
      containerDeclarations.push(
        `--callout-border-color: ${value};`,
        `border-color: ${value};`,
      );
    }
    if (variant.background !== undefined) {
      const value = safeValue(variant.background, background);
      containerDeclarations.push(`--callout-background: ${value};`, `background-color: ${value};`);
    }
    if (containerDeclarations.length > 0) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] {
  ${containerDeclarations.join('\n  ')}
}`,
      );
    }
    const innerDeclarations: string[] = [];
    if (variant.textColor !== undefined) {
      innerDeclarations.push(`color: ${safeValue(variant.textColor, textColor)};`);
    }
    if (innerDeclarations.length > 0) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-content {
  ${innerDeclarations.join('\n  ')}
}`,
      );
    }
    if (variant.titleColor !== undefined) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-title {
  color: ${safeValue(variant.titleColor, titleColor)};
}`,
      );
    }
    if (variant.iconColor !== undefined) {
      variantRules.push(
        `${scope} .templar-page :is(.callout, .cm-callout)[data-callout="${type}"] .callout-icon {
  color: ${safeValue(variant.iconColor, iconColor)};
}`,
      );
    }
  }
  return variantRules.length > 0 ? `${base}\n\n${variantRules.join('\n\n')}` : base;
}


export function compileBlocks(context: StyleCompilerContext): string {
  const { style, scope, gridded, unit, blockSpacing, textColor } = context;
  return `${scope} .templar-page table {
  border-collapse: collapse;
  border-color: ${safeValue(style.blocks.tableBorder, 'currentColor')};
  font-size: ${px(style.blocks.tableFontSize)};
}

${scope} .templar-page :is(th, td) {
  border-color: ${safeValue(style.blocks.tableBorder, 'currentColor')};
  border-width: ${px(style.blocks.tableBorderWidth)};
  padding: ${px(style.blocks.tablePadding)};
  text-align: start;
}

${scope} .templar-page th {
  background: ${safeValue(style.blocks.tableHeaderBackground, 'transparent')};
  color: ${safeValue(style.blocks.tableHeaderTextColor, textColor)};
}

${scope} .templar-page td {
  color: ${safeValue(style.blocks.tableTextColor, textColor)};
}

${style.blocks.tableStriped ? `${scope} .templar-page tbody tr:nth-child(even) {
  background: ${safeValue(style.blocks.tableStripeColor, 'rgba(48, 46, 43, 0.045)')};
}

` : ''}${scope} .templar-page hr {
  ${gridded ? griddedDividerDeclarations(style, unit) : `${dividerDeclarations(style)}
  border-bottom: 0;
  border-inline: 0;
  margin-block: ${px(blockSpacing)} !important;`}
}

${scope} .templar-page .HyperMD-hr {
  ${gridded ? griddedDividerDeclarations(style, unit) : 'border: 0 !important; margin-block: 0 !important; padding-block: 0 !important;'}
}

${scope} .templar-page .cm-hr {
  ${gridded ? 'background: transparent; border: 0; height: 100%; width: 100%;' : `background-color: ${safeValue(style.blocks.dividerColor, 'rgba(48, 46, 43, 0.35)')};
  height: ${px(Math.max(style.blocks.dividerWidth, 1))};`}
  margin: 0;
  padding: 0;
  ${!gridded && style.blocks.dividerStyle === 'fade' ? `-webkit-mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);
  mask-image: linear-gradient(to right, transparent, #000 10%, #000 90%, transparent);` : ''}
}

${calloutRules(style, scope)}

${scope} .templar-page :is(.internal-embed, .file-embed) {
  background: ${safeValue(style.blocks.embedBackground, 'rgba(48, 46, 43, 0.06)')};
  border-radius: ${px(style.blocks.embedRadius)};
}

${scope} .templar-page :is(.markdown-embed-link, .markdown-embed-title, .file-embed-title) {
  color: ${safeValue(style.blocks.embedAccent, '#9fb8ca')};
}`;
}
