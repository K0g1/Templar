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

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item:not(.templar-baseline-grid-atomic) {
  display: flow-root;
  margin-block-end: var(--templar-grid-natural-margin-after, 0px) !important;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item:not(.templar-baseline-grid-atomic)::after {
  block-size: var(--templar-grid-after, 0px);
  clear: both;
  content: "";
  display: block;
  inline-size: 100%;
  pointer-events: none;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-item.templar-baseline-grid-atomic {
  margin-block-end: calc(var(--templar-grid-natural-margin-after, 0px) + var(--templar-grid-after, 0px)) !important;
}

${scope} .markdown-source-view.mod-cm6 .templar-page .cm-content > .cm-line.templar-baseline-grid-item {
  /* CodeMirror's height map and pointer coordinates require this invariant. */
  margin-block: 0 !important;
  padding-block-start: 0 !important;
  padding-block-end: 0 !important;
}

${scope} .markdown-preview-view.templar-page .templar-baseline-grid-intentional {
  display: block;
  height: calc(var(--templar-body-line-height) * var(--templar-blank-lines, 1)) !important;
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
