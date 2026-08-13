import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/templates/settings';
import { normalizeSettingsWithIssues } from '../src/templates/settings';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { clone } from '../src/utils/value';

describe('settings migration', () => {
  it('fills UX defaults for legacy settings', () => {
    const settings = normalizeSettings({ favouriteTemplateIds: ['a'] });
    expect(settings.defaultNewPageFlow).toBe('pageless');
    expect(settings.libraryDensity).toBe('comfortable');
    expect(settings.recentTemplateIds).toEqual([]);
    expect(settings.styleRules).toEqual([]);
  });

  it('normalizes rules and caps unique recents', () => {
    const settings = normalizeSettings({
      recentTemplateIds: ['a', 'a', 'b'],
      styleRules: [{ name: 'Journal', templateId: 'classic-ruled', conditions: [{ type: 'tag', tag: '#Journal' }], pageFlow: 'paged-letter' }],
    });
    expect(settings.recentTemplateIds).toEqual(['a', 'b']);
    expect(settings.styleRules[0]).toMatchObject({ id: 'journal', pageFlow: 'paged-letter' });
    expect(settings.styleRules[0]?.conditions[0]).toEqual({ type: 'tag', tag: 'Journal' });
  });

  it('clamps numeric settings, drops unknown keys, and bounds rule work', () => {
    const settings = normalizeSettings({
      defaultGridUnit: 999,
      fontCacheSize: 33,
      futureSetting: 'discard me',
      favouriteTemplateIds: ['a', 'a', '', 'b'],
      styleRules: Array.from({ length: 140 }, (_, index) => ({
        id: `rule-${String(index)}`,
        templateId: 'classic-ruled',
        conditions: Array.from({ length: 40 }, () => ({ type: 'folder', folder: 'Notes' })),
      })),
    });
    expect(settings.defaultGridUnit).toBe(60);
    expect(settings.fontCacheSize).toBe(32);
    expect(settings.favouriteTemplateIds).toEqual(['a', 'b']);
    expect(settings.styleRules).toHaveLength(128);
    expect(settings.styleRules[0]?.conditions).toHaveLength(32);
    expect((settings as unknown as Record<string, unknown>).futureSetting).toBeUndefined();
  });

  it('quarantines invalid user templates without discarding valid ones', () => {
    const valid = clone(BUILT_IN_TEMPLATES[0]!);
    valid.id = 'saved-custom';
    valid.builtIn = false;
    const result = normalizeSettingsWithIssues({
      userTemplates: [valid, { version: 99, id: 'future-style' }, { malformed: true }],
    });
    expect(result.settings.userTemplates.map((template) => template.id)).toEqual(['saved-custom']);
    expect(result.issues).toHaveLength(2);
    expect(result.issues[0]?.templateId).toBe('future-style');
    expect(result.issues[0]?.raw).toEqual({ version: 99, id: 'future-style' });
    expect(result.issues[0]?.kind).toBe('future-version');
    expect(result.issues[1]?.raw).toEqual({ malformed: true });
    expect(result.issues[1]?.kind).toBe('invalid');
  });
});
