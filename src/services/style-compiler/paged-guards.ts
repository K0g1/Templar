import type { StyleCompilerContext } from './types';
import { px } from './paper';

/** Prevents host/theme rules from changing a fixed paged canvas. */
export function compilePagedGuards(context: StyleCompilerContext): string {
  if (!context.paged) return '';
  const { style, scope } = context;
  return `${scope} .templar-page-content,
${scope} .markdown-preview-view.templar-page .templar-page-content.markdown-preview-sizer,
${scope} .markdown-source-view.mod-cm6 .templar-page-content.cm-sizer {
  block-size: auto !important;
  box-sizing: border-box !important;
  columns: auto !important;
  contain: none !important;
  container-type: normal !important;
  content-visibility: visible !important;
  display: block !important;
  float: none !important;
  font-family: inherit !important;
  font-size: inherit !important;
  font-weight: inherit !important;
  height: auto !important;
  inline-size: ${px(style.page.width)} !important;
  inset: auto !important;
  isolation: isolate !important;
  line-height: inherit !important;
  margin-block: 0 !important;
  margin-inline: auto !important;
  max-block-size: none !important;
  max-height: none !important;
  max-inline-size: ${px(style.page.width)} !important;
  max-width: ${px(style.page.width)} !important;
  min-block-size: var(--templar-canvas-height, ${px(style.page.height)}) !important;
  min-height: var(--templar-canvas-height, ${px(style.page.height)}) !important;
  min-inline-size: ${px(style.page.width)} !important;
  min-width: ${px(style.page.width)} !important;
  opacity: 1 !important;
  overflow: visible !important;
  padding: ${px(style.layout.paddingTop)} ${px(style.layout.paddingRight)} ${px(style.layout.paddingBottom)} ${px(style.layout.paddingLeft)} !important;
  position: relative !important;
  rotate: none !important;
  scale: none !important;
  transform: none !important;
  translate: none !important;
  visibility: visible !important;
  width: ${px(style.page.width)} !important;
  writing-mode: horizontal-tb !important;
  zoom: var(--templar-page-scale) !important;
}

${scope} .templar-page .templar-page-content [style*="--templar-page-break"] {
  margin-block-start: calc(var(--templar-original-margin-top, 0px) + var(--templar-page-break, 0px)) !important;
}`;
}
