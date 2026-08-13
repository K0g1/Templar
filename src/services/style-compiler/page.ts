import type { StyleCompilerContext } from './types';
import { paperColorDeclaration, px, safeValue } from './paper';

/** Compiles the page root, paper surface, and shared canvas geometry. */
export function compilePageBase(context: StyleCompilerContext): string {
  const {
    style,
    scope,
    paged,
    bodyLineHeight,
    baselinePosition,
    blockSpacing,
    pageGap,
    pageSpan,
    paddingLeft,
    paddingRight,
    paperPattern,
    paperColor,
    textColor,
    bodyFont,
    imageBorder,
    watermarkText,
  } = context;
  return `${scope} {
  --templar-grid: ${px(context.unit)};
  --templar-baseline-position: ${px(baselinePosition)};
  --templar-editor-baseline-position: ${px(baselinePosition)};
  --templar-paper-baseline-position: var(--templar-editor-baseline-position);
  --templar-image-border: ${imageBorder};
  --templar-page-width: ${px(style.page.width)};
  --templar-page-height: ${px(style.page.height)};
  --templar-page-gap: ${px(pageGap)};
  --templar-page-span: ${px(pageSpan)};
  --templar-page-scale: 1;
  --templar-body-line-height: ${px(bodyLineHeight)};
  --templar-watermark: "${watermarkText}";
}

${scope} .templar-page {
  ${paged ? 'background: var(--background-secondary);' : `${paperColorDeclaration(paperColor)}`}
  border-radius: ${paged ? '0' : px(style.layout.pageRadius)};
  box-shadow: ${paged ? 'none' : safeValue(style.layout.pageShadow, 'none')};
  color: ${textColor};
  font-family: ${bodyFont};
  font-size: ${px(style.typography.bodySize)};
  font-weight: ${String(style.typography.bodyWeight)};
  line-height: ${px(bodyLineHeight)};
  min-height: 100%;
  overflow-x: ${paged ? 'auto' : 'hidden'};
  padding: 0 !important;
}

${scope} .markdown-preview-view.templar-page,
${scope} .markdown-source-view.mod-cm6 .cm-scroller.templar-page {
  padding: 0 !important;
}

${scope} .markdown-source-view.mod-cm6 .cm-scroller.templar-page {
  color: ${textColor};
  font-family: ${bodyFont};
  font-size: ${px(style.typography.bodySize)};
  font-weight: ${String(style.typography.bodyWeight)};
  line-height: ${px(bodyLineHeight)};
}

${scope} .templar-page-content {
  ${paged ? '' : 'background-color: transparent;'}
  box-sizing: border-box;
  isolation: isolate;
  margin-inline: auto;
  max-width: ${paged ? 'none' : px(style.layout.maxWidth)};
  min-height: ${paged ? `var(--templar-canvas-height, ${px(style.page.height)})` : '100%'};
  padding: ${px(style.layout.paddingTop)} ${paddingRight} ${px(style.layout.paddingBottom)} ${paddingLeft};
  position: relative;
  width: ${paged ? px(style.page.width) : '100%'};
  zoom: ${paged ? 'var(--templar-page-scale)' : '1'};
}

${paged ? '' : `${scope} .templar-page-content::before {
  ${paperPattern}
  background-color: ${paperColor};
  content: "";
  inset: 0;
  pointer-events: none;
  position: absolute;
  z-index: -1;
}`}

${scope} .templar-page-content.markdown-preview-sizer,
${scope} .templar-page-content.cm-sizer,
${scope} .markdown-preview-view.templar-page .templar-page-content.markdown-preview-sizer,
${scope} .markdown-source-view.mod-cm6 .templar-page-content.cm-sizer {
  box-sizing: border-box !important;
  max-width: ${paged ? 'none' : px(style.layout.maxWidth)};
  padding: ${px(style.layout.paddingTop)} ${paddingRight} ${px(style.layout.paddingBottom)} ${paddingLeft} !important;
  width: ${paged ? px(style.page.width) : '100%'};
}

${scope} .templar-page .cm-content,
${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content {
  caret-color: ${textColor};
  line-height: ${px(bodyLineHeight)};
  max-width: none;
  padding: 0;
  width: 100%;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line {
  box-sizing: border-box;
  margin-block: 0 !important;
}

${paged ? `${scope} .templar-page .cm-line,
${scope} .markdown-source-view.mod-cm6 .templar-page .cm-line {
  max-width: none;
}` : ''}

${scope} .templar-page :is(p, li, .HyperMD-paragraph, .HyperMD-list-line, .HyperMD-quote) {
  line-height: ${px(bodyLineHeight)};
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.HyperMD-list-line {
  line-height: ${px(bodyLineHeight)} !important;
  margin-block: 0 !important;
  min-height: ${px(bodyLineHeight)} !important;
  padding-block: 0 !important;
}

${scope} .templar-page-content li {
  margin-block: 0 !important;
  padding-block: 0 !important;
}

${scope} .templar-page-content li > :is(p, ul, ol) {
  line-height: ${px(bodyLineHeight)};
  margin-block: 0 !important;
}

${scope} .markdown-preview-view.templar-page :is(p, ul, ol, blockquote, pre, table) {
  margin-block: 0 ${px(blockSpacing)} !important;
}

${scope} .markdown-preview-view.templar-page li > :is(p, ul, ol) {
  margin-block: 0 !important;
}`;
}
