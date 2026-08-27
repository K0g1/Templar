import type { StyleCompilerContext } from './types';
import { px } from './paper';

/**
 * Static rules for the absolute-phase engine.  JavaScript supplies only the
 * measured correction variables; this fragment owns their layout semantics.
 */
export function compileBaselineGrid(context: StyleCompilerContext): string {
  if (!context.gridded) return '';
  const { scope, unit } = context;
  return `${scope} .templar-page {
  --templar-grid-unit: ${px(unit)};
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item {
  --templar-grid-before: 0px;
  --templar-grid-after: 0px;
  margin-block-start: calc(var(--templar-grid-natural-margin-before, 0px) + var(--templar-grid-before)) !important;
}

/* Flex items have independent vertical margins. This prevents a theme or an
 * empty frontmatter wrapper from collapsing a correction away before the
 * fixed lattice can position the next rendered block. */
${scope} .markdown-preview-view.templar-page .templar-page-content.markdown-preview-section,
${scope} .markdown-preview-view.templar-page .templar-page-content > .markdown-preview-section {
  display: flex;
  flex-direction: column;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item:not(.templar-baseline-grid-atomic) {
  display: flow-root;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item.templar-baseline-grid-atomic {
  display: flow-root;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-list-item {
  /* Inline content can make a list line box fractional; move only its visual
   * line box so the list's natural wrapping and outer footprint remain intact. */
  inset-block-start: var(--templar-grid-list-shift, 0px);
  position: relative;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-composite-text {
  /* Inline formatting can give a nested paragraph a fractional border-box
   * top. Move only that visible text box; the composite's occupied height and
   * the page-flow owner stay untouched. */
  inset-block-start: var(--templar-grid-composite-text-shift, 0px);
  position: relative;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.templar-baseline-grid-item {
  /* CodeMirror's height map and pointer coordinates require this invariant. */
  margin-block: 0 !important;
  padding-block-start: 0 !important;
  padding-block-end: 0 !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .templar-baseline-grid-prefix {
  margin-block-end: calc(var(--templar-grid-prefix-natural-margin-end, 0px) + var(--templar-grid-prefix-shift, 0px)) !important;
}

/* CodeMirror may put formatting spans, widget buffers, and rendered inline
 * decorations in one editable line. Aligning their inline boxes to the line
 * top prevents a replaced element or a bold span from adding a fractional
 * half-pixel to the line's height map. The line itself remains CodeMirror
 * owned: no vertical margin, padding, or controller class is written to it. */
${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line > * {
  vertical-align: top !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .templar-baseline-grid-item.templar-baseline-grid-atomic {
  display: flow-root;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-intentional {
  display: block;
  height: calc(var(--templar-grid-unit) * var(--templar-blank-lines, 1)) !important;
  margin: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
}

${scope} .templar-page :is(.callout-title, .callout-content, .callout-content > :is(p, ul, ol, blockquote, pre), .callout-content li, .callout-content code, th, td) {
  line-height: ${px(unit)} !important;
}

${scope} .templar-page table :is(th, td) {
  vertical-align: baseline;
}

${scope} .templar-page .templar-baseline-table-row > :is(th, td) {
  padding-block-end: calc(var(--templar-grid-natural-cell-padding-bottom, 0px) + var(--templar-grid-row-after, 0px)) !important;
}

${scope} .templar-page .templar-baseline-debug-overlay {
  height: 100%;
  inset: 0;
  overflow: visible;
  pointer-events: none;
  position: absolute;
  width: 100%;
  z-index: 1000;
}`;
}
