import { describe, expect, it } from 'vitest';
import { normalizeSettings } from '../src/templates/settings';

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
});
