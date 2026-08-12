import type { StyleCompilerContext } from './types';
import { px, safeValue } from './paper';

/** Compiles text, code, links, quotes, and shared inline semantics. */
export function compileTypography(context: StyleCompilerContext): string {
  const { style, scope, unit, bodyLineHeight, textColor, mutedColor } = context;
  const codePadding = context.codePadding;
  return `${scope} .templar-page :is(a, .cm-hmd-internal-link, .cm-link, .cm-url) {
  color: ${safeValue(style.blocks.linkColor, '#315f86')};
  text-decoration-thickness: 1px;
  text-underline-offset: 0.16em;
}

${scope} .templar-page mark,
${scope} .markdown-source-view.mod-cm6 .templar-page :is(.cm-highlight, .cm-formatting-highlight) {
  background-color: ${safeValue(style.blocks.highlightBackground, 'rgba(246, 210, 74, 0.52)')};
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  color: ${safeValue(style.blocks.highlightTextColor, '#302e2b')};
}

${scope} .templar-page :is(blockquote, .HyperMD-quote) {
  background: ${safeValue(style.blocks.quoteBackground, 'transparent')};
  border-inline-start: 3px solid ${safeValue(style.blocks.quoteAccent, 'currentColor')};
  color: ${safeValue(style.blocks.quoteTextColor, textColor)};
  padding-inline: ${px(unit / 2)};
}

${scope} .templar-page :is(code, .cm-inline-code) {
  background: ${safeValue(style.blocks.codeBackground, 'rgba(0, 0, 0, 0.08)')};
  color: ${safeValue(style.blocks.codeTextColor, textColor)};
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
}

${scope} .templar-page pre {
  background: ${safeValue(style.blocks.codeBackground, 'rgba(0, 0, 0, 0.08)')};
  color: ${safeValue(style.blocks.codeTextColor, textColor)};
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
  line-height: ${px(bodyLineHeight)} !important;
  padding: ${px(codePadding.top)} ${px(unit / 2)} ${px(codePadding.bottom)} !important;
}

${scope} .templar-page pre > code {
  background: transparent;
  color: inherit;
  display: block;
  font: inherit;
  line-height: inherit;
  padding: 0 !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.HyperMD-codeblock {
  font-family: ${safeValue(style.blocks.codeFont, 'monospace')};
  font-size: ${px(style.blocks.codeSize)};
  line-height: ${px(bodyLineHeight)} !important;
  min-height: ${px(bodyLineHeight)} !important;
  padding-block: 0 !important;
}

${scope} .templar-page :is(figcaption, small, .cm-comment, .list-bullet, .collapse-indicator, .footnote-ref) {
  color: ${mutedColor};
}`;
}
