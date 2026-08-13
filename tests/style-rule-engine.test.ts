import { describe, expect, it, vi } from 'vitest';
import { TFile } from 'obsidian';
import { StyleRuleEngine } from '../src/services/style-rule-engine';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { clone } from '../src/utils/value';

function note(path: string): TFile {
  return Object.assign(Object.create(TFile.prototype) as TFile, {
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    extension: 'md',
    parent: { path: path.split('/').slice(0, -1).join('/') },
    path,
  });
}

describe('StyleRuleEngine', () => {
  it('applies the first metadata-ready rule with its page flow', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    settings.defaultNewPageFlow = 'pageless';
    settings.styleRules = [{
      id: 'notes-rule',
      name: 'Notes',
      enabled: true,
      conditions: [{ type: 'folder', folder: 'Notes', includeSubfolders: true }],
      templateId: BUILT_IN_TEMPLATES[0]!.id,
      pageFlow: 'paged-letter',
    }];
    const file = note('Notes/Ideas.md');
    const apply = vi.fn(async () => undefined);
    const engine = new StyleRuleEngine({
      app: { metadataCache: { getFileCache: vi.fn(() => null) } } as never,
      settings,
      library: { get: vi.fn(() => BUILT_IN_TEMPLATES[0]) } as never,
      frontmatter: { inspect: vi.fn(() => ({ status: 'absent', fingerprint: 'absent-at-review' })) } as never,
      isReady: () => true,
      apply,
    });

    await engine.evaluate(file, true);

    expect(apply).toHaveBeenCalledWith({
      template: BUILT_IN_TEMPLATES[0],
      file,
      pageOptions: { mode: 'paged', size: 'letter', width: 816, height: 1056, gap: 32, scaleToFit: true },
      appliedByRule: { id: 'notes-rule', name: 'Notes' },
      guard: { expectedRawFingerprint: 'absent-at-review' },
    });
  });

  it('does not apply while the metadata policy is not ready', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    settings.styleRules = [{
      id: 'tag-rule',
      name: 'Tagged',
      enabled: true,
      conditions: [{ type: 'tag', tag: '#todo' }],
      templateId: BUILT_IN_TEMPLATES[0]!.id,
      pageFlow: 'default',
    }];
    const apply = vi.fn(async () => undefined);
    const engine = new StyleRuleEngine({
      app: { metadataCache: { getFileCache: vi.fn(() => null) } } as never,
      settings,
      library: { get: vi.fn(() => BUILT_IN_TEMPLATES[0]) } as never,
      frontmatter: { inspect: vi.fn(() => ({ status: 'absent', fingerprint: 'absent-at-review' })) } as never,
      isReady: () => true,
      apply,
    });

    await engine.evaluate(note('Notes/Todo.md'), false);

    expect(apply).not.toHaveBeenCalled();
  });

  it.each(['current', 'unsupported-future', 'invalid'] as const)(
    'never applies a rule to %s Templar data',
    async (status) => {
      const settings = clone(DEFAULT_SETTINGS);
      settings.styleRules = [{
        id: 'guarded-rule',
        name: 'Guarded',
        enabled: true,
        conditions: [{ type: 'folder', folder: 'Notes', includeSubfolders: true }],
        templateId: BUILT_IN_TEMPLATES[0]!.id,
        pageFlow: 'default',
      }];
      const apply = vi.fn(async () => undefined);
      const engine = new StyleRuleEngine({
        app: { metadataCache: { getFileCache: vi.fn(() => null) } } as never,
        settings,
        library: { get: vi.fn(() => BUILT_IN_TEMPLATES[0]) } as never,
        frontmatter: { inspect: vi.fn(() => ({ status, fingerprint: 'protected-or-current' })) } as never,
        isReady: () => true,
        apply,
      });

      await engine.evaluate(note('Notes/Guarded.md'), true);
      expect(apply).not.toHaveBeenCalled();
    },
  );
});
