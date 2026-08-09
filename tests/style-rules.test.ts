import { describe, expect, it } from 'vitest';
import { firstMatchingRule, pageFlowOptions, ruleMatches } from '../src/services/style-rules';
import type { StyleRule } from '../src/types';

const facts = {
  path: 'Research/Clients/Meeting Notes.md',
  basename: 'Meeting Notes',
  folder: 'Research/Clients',
  tags: ['#Client', '#meeting'],
  frontmatter: { status: 'Published', priority: 2 },
  metadataReady: true,
};

describe('style rules', () => {
  it('matches AND conditions naturally and case-insensitively', () => {
    const rule: StyleRule = {
      id: 'research', name: 'Research', enabled: true, templateId: 'academic-paper', pageFlow: 'paged-a4',
      conditions: [
        { type: 'folder', folder: 'research', includeSubfolders: true },
        { type: 'tag', tag: 'CLIENT' },
        { type: 'filename', operator: 'contains', value: 'meeting' },
        { type: 'frontmatter', property: 'status', value: 'published' },
      ],
    };
    expect(ruleMatches(rule, facts)).toBe(true);
    expect(ruleMatches({ ...rule, conditions: [{ type: 'folder', folder: 'Research', includeSubfolders: false }] }, facts)).toBe(false);
  });

  it('waits for metadata and honors first-match priority', () => {
    const folderRule: StyleRule = { id: 'folder', name: 'Folder', enabled: true, templateId: 'a', pageFlow: 'pageless', conditions: [{ type: 'folder', folder: 'Research', includeSubfolders: true }] };
    const tagRule: StyleRule = { id: 'tag', name: 'Tag', enabled: true, templateId: 'b', pageFlow: 'pageless', conditions: [{ type: 'tag', tag: 'meeting' }] };
    expect(firstMatchingRule([folderRule, tagRule], facts)?.id).toBe('folder');
    expect(ruleMatches(tagRule, { ...facts, metadataReady: false })).toBe(false);
    expect(firstMatchingRule([tagRule, folderRule], { ...facts, metadataReady: false })).toBeNull();
    const impossibleTagRule: StyleRule = {
      ...tagRule,
      conditions: [
        { type: 'folder', folder: 'Journal', includeSubfolders: true },
        { type: 'tag', tag: 'meeting' },
      ],
    };
    expect(firstMatchingRule([impossibleTagRule, folderRule], { ...facts, metadataReady: false })?.id).toBe('folder');
  });

  it('maps deterministic page-flow presets', () => {
    expect(pageFlowOptions('paged-letter')).toMatchObject({ mode: 'paged', size: 'letter', width: 816 });
    expect(pageFlowOptions('pageless').mode).toBe('pageless');
  });
});
