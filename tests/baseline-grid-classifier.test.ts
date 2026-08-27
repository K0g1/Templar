/* @vitest-environment happy-dom */

import { describe, expect, it } from 'vitest';
import {
  classifyFlowElement,
  collectFlowItems,
  flowTarget,
  flowOwner,
} from '../src/services/rendering/baseline-grid/classifier';
import { installObsidianDomExtensions } from './harness/obsidian';

function element(owner: Window, tag: string, className = ''): HTMLElement {
  const value = owner.document.createElement(tag);
  value.className = className;
  return value;
}

describe('baseline-grid flow classification and ownership', () => {
  it('classifies the Reading View block vocabulary without claiming UI', () => {
    const owner = window.open() as Window;
    installObsidianDomExtensions(owner);
    const cases: Array<[string, string, string]> = [
      ['h2', '', 'heading'],
      ['p', '', 'text'],
      ['ul', '', 'list'],
      ['ol', '', 'list'],
      ['blockquote', '', 'composite'],
      ['pre', '', 'code'],
      ['table', '', 'composite'],
      ['div', 'callout', 'composite'],
      ['hr', '', 'divider'],
      ['img', '', 'image'],
      ['div', 'block-language-mermaid', 'atomic'],
      ['div', 'math-block', 'atomic'],
      ['div', 'templar-blank-line-spacer', 'blank-space'],
      ['div', 'mod-ui', 'non-rhythmic-ui'],
    ];
    for (const [tag, className, expected] of cases) {
      expect(classifyFlowElement(element(owner, tag, className), 'reading'), `${tag}.${className}`).toBe(expected);
    }
    owner.close();
  });

  it('returns one top-level owner for Reading composites and Live Preview widgets', () => {
    const owner = window.open() as Window;
    installObsidianDomExtensions(owner);

    const readingContent = element(owner, 'div', 'templar-page-content markdown-preview-sizer');
    const section = element(owner, 'div', 'markdown-preview-section');
    const table = element(owner, 'table');
    table.append(element(owner, 'tr'));
    const callout = element(owner, 'div', 'callout');
    callout.append(element(owner, 'div', 'callout-title'), element(owner, 'div', 'callout-content'));
    const metadata = element(owner, 'div', 'metadata-container');
    section.append(metadata, table, callout, element(owner, 'p'));
    readingContent.append(section);
    expect(collectFlowItems(readingContent, 'reading')).toEqual([table, callout, section.lastElementChild]);
    expect(flowOwner(table.querySelector('tr') as HTMLElement, 'reading')).toBe(table);
    expect(flowOwner(callout.querySelector('.callout-title') as HTMLElement, 'reading')).toBe(callout);

    const editorSizer = element(owner, 'div', 'cm-sizer');
    const editorContent = element(owner, 'div', 'cm-content');
    const frontmatter = element(owner, 'div', 'cm-line HyperMD-frontmatter');
    const line = element(owner, 'div', 'cm-line HyperMD-paragraph');
    const gap = element(owner, 'div', 'cm-gap');
    const widget = element(owner, 'div', 'cm-table-widget');
    const nestedCell = element(owner, 'div', 'cm-line');
    widget.append(nestedCell);
    editorContent.append(frontmatter, line, gap, widget);
    editorSizer.append(editorContent);
    expect(collectFlowItems(editorSizer, 'live-preview')).toEqual([line, gap, widget]);
    expect(classifyFlowElement(gap, 'live-preview')).toBe('editor-widget');
    expect(flowOwner(nestedCell, 'live-preview')).toBe(widget);
    owner.close();
  });

  it('treats Obsidian el-* render wrappers as the top-level Reading owners', () => {
    const owner = window.open() as Window;
    installObsidianDomExtensions(owner);
    const content = element(owner, 'div', 'templar-page-content markdown-preview-sizer markdown-preview-section');
    const headingWrapper = element(owner, 'div', 'el-h2');
    const heading = element(owner, 'h2');
    heading.textContent = 'Wrapped heading';
    headingWrapper.append(heading);
    const listWrapper = element(owner, 'div', 'el-ul');
    const list = element(owner, 'ul');
    list.append(element(owner, 'li'));
    listWrapper.append(list);
    content.append(headingWrapper, listWrapper);
    expect(collectFlowItems(content, 'reading')).toEqual([headingWrapper, listWrapper]);
    expect(classifyFlowElement(headingWrapper, 'reading')).toBe('heading');
    expect(classifyFlowElement(listWrapper, 'reading')).toBe('list');
    expect(flowOwner(heading, 'reading')).toBe(headingWrapper);
    owner.close();
  });

  it('keeps embedded notes atomic when Obsidian wraps them in an el-p block', () => {
    const owner = window.open() as Window;
    installObsidianDomExtensions(owner);
    const content = element(owner, 'div', 'templar-page-content markdown-preview-sizer markdown-preview-section');
    const wrapper = element(owner, 'div', 'el-p');
    const paragraph = element(owner, 'p');
    paragraph.textContent = 'Embed label';
    const embed = element(owner, 'div', 'internal-embed markdown-embed inline-embed is-loaded');
    const embeddedSection = element(owner, 'div', 'markdown-preview-section');
    embeddedSection.append(element(owner, 'h1'), element(owner, 'p'));
    embed.append(embeddedSection);
    wrapper.append(paragraph, embed);
    content.append(wrapper);

    expect(collectFlowItems(content, 'reading')).toEqual([wrapper]);
    expect(classifyFlowElement(wrapper, 'reading')).toBe('atomic');
    expect(flowOwner(embed, 'reading')).toBe(wrapper);
    owner.close();
  });

  it('resolves wrapped table and image semantics at their layout owner', () => {
    const owner = window.open() as Window;
    installObsidianDomExtensions(owner);
    const content = element(owner, 'div', 'templar-page-content markdown-preview-sizer markdown-preview-section');
    const tableWrapper = element(owner, 'div', 'el-table');
    const table = element(owner, 'table');
    table.append(element(owner, 'tr'));
    tableWrapper.append(table);
    const imageWrapper = element(owner, 'div', 'el-p');
    const image = element(owner, 'img');
    imageWrapper.append(image);
    content.append(tableWrapper, imageWrapper);

    expect(classifyFlowElement(tableWrapper, 'reading')).toBe('composite');
    expect(flowTarget(tableWrapper, 'reading')).toBe(table);
    expect(classifyFlowElement(imageWrapper, 'reading')).toBe('image');
    expect(flowTarget(imageWrapper, 'reading')).toBe(image);
    owner.close();
  });
});
