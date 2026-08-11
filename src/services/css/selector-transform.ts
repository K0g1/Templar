import { transformSelectorAst } from './selector-policy';

export const LIVE_PREVIEW_ELEMENTS: Readonly<Record<string, string>> = {
  h1: ':is(h1, .HyperMD-header-1, .inline-title)',
  h2: ':is(h2, .HyperMD-header-2)',
  h3: ':is(h3, .HyperMD-header-3)',
  h4: ':is(h4, .HyperMD-header-4)',
  h5: ':is(h5, .HyperMD-header-5)',
  h6: ':is(h6, .HyperMD-header-6)',
  p: ':is(p, .HyperMD-paragraph)',
  ul: ':is(ul, .HyperMD-list-line)',
  ol: ':is(ol, .HyperMD-list-line)',
  li: ':is(li, .HyperMD-list-line)',
  blockquote: ':is(blockquote, .HyperMD-quote)',
  img: 'img',
  table: ':is(table, .cm-table-widget)',
  code: ':is(code, .cm-inline-code)',
  pre: ':is(pre, .HyperMD-codeblock)',
  hr: ':is(hr, .HyperMD-hr)',
  a: ':is(a, .cm-hmd-internal-link, .cm-link, .cm-url)',
  mark: ':is(mark, .cm-highlight)',
  input: 'input',
};

export function transformVirtualSelectorWithAst(selector: string, scope: string): string {
  return transformSelectorAst(selector, scope, LIVE_PREVIEW_ELEMENTS);
}
