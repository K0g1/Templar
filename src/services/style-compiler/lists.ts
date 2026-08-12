import type { StyleCompilerContext } from './types';
import { px, safeValue } from './paper';

export function listSelector(ordered: boolean): string {
  return ordered ? 'ol' : 'ul';
}

/** Compiles list markers, indentation, and optional paragraph typography. */
export function compileLists(context: StyleCompilerContext): string {
  const { style, scope, gridded } = context;
  return `${scope} .templar-page :is(ul, ol) :is(ul, ol) {
  ${style.lists.nestedIndent > 0
    ? `padding-inline-start: ${px(style.lists.nestedIndent)} !important;`
    : ''}
  ${style.lists.indentGuides
    ? `border-inline-start: 1px solid ${safeValue(style.lists.indentGuideColor, 'rgba(48, 46, 43, 0.18)')};`
    : ''}
}

${scope} .templar-page ul {
  list-style-type: ${style.lists.markerStyle};
}

${scope} .templar-page :is(ul, ol) li::marker {
  color: ${safeValue(style.lists.markerColor, '#706c66')};
}

${scope} .templar-page ul .list-bullet {
  display: none;
}

${scope} .markdown-source-view.mod-cm6 .templar-page :is(.cm-formatting-list-ul, .cm-formatting-list-ol) {
  color: ${safeValue(style.lists.markerColor, '#706c66')};
}

${style.typography.firstLineIndent > 0 ? `${scope} .templar-page-content p {
  text-indent: ${px(style.typography.firstLineIndent)};
}

` : ''}${style.typography.dropCap ? `${scope} .templar-page-content :is(h1, h2, h3) ~ p:first-of-type::first-letter,
${scope} .templar-page-content .HyperMD-header + .HyperMD-paragraph::first-letter {
  float: left;
  font-size: 3.2em;
  font-weight: 700;
  line-height: 0.8;
  margin-block-start: 0.04em;
  margin-inline-end: 0.1em;
}

` : ''}${gridded ? `${scope} .templar-grid-snap-block:not(:is(table, iframe, object, video, audio, canvas)) {
  display: flow-root;
}

${scope} .templar-grid-snap-block:not(:is(table, iframe, object, video, audio, canvas))::after {
  block-size: var(--templar-grid-snap, 0px);
  clear: both;
  content: "";
  display: block;
  inline-size: 100%;
  pointer-events: none;
}

${scope} .templar-grid-snap-block:is(table, iframe, object, video, audio, canvas) {
  margin-block-end: calc(var(--templar-grid-natural-margin-end, 0px) + var(--templar-grid-snap, 0px)) !important;
}

` : ''}${scope} .markdown-preview-view.templar-page .templar-blank-line-spacer {
  height: calc(var(--templar-body-line-height) * var(--templar-blank-lines, 1));
  margin: 0 !important;
  min-height: 0 !important;
  padding: 0 !important;
  pointer-events: none;
}`;
}
