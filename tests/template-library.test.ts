import { describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from '../src/services/template-library';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { clone } from '../src/utils/value';
import { SettingsStore } from '../src/services/settings-store';
import type { TemplarSettings, TemplarTemplate } from '../src/types';

function createLibrary(
  overrides: Partial<TemplarSettings> = {},
): { library: TemplateLibrary; settings: TemplarSettings; persist: ReturnType<typeof vi.fn> } {
  const settings = { ...clone(DEFAULT_SETTINGS), ...overrides };
  const persisted: TemplarSettings[] = [];
  const persist = vi.fn(async (candidate: TemplarSettings) => {
    persisted.push(clone(candidate));
  });
  const store = new SettingsStore(settings, persist);
  return { library: new TemplateLibrary(settings, store), settings, persist };
}

describe('TemplateLibrary favorites', () => {
  it('starts without favourites and toggles them on and off', async () => {
    const { library } = createLibrary();
    expect(library.isFavourite('classic-ruled')).toBe(false);
    await expect(library.toggleFavourite('classic-ruled')).resolves.toBe(true);
    expect(library.isFavourite('classic-ruled')).toBe(true);
    await expect(library.toggleFavourite('classic-ruled')).resolves.toBe(false);
    expect(library.isFavourite('classic-ruled')).toBe(false);
  });

  it('persists after every toggle', async () => {
    const { library, persist } = createLibrary();
    await library.toggleFavourite('graph-paper');
    await library.toggleFavourite('graph-paper');
    expect(persist).toHaveBeenCalledTimes(2);
  });

  it('keeps stored favourites across new library instances', async () => {
    const { settings } = createLibrary();
    const store = new SettingsStore(settings, async () => undefined);
    await new TemplateLibrary(settings, store).toggleFavourite('classic-ruled');
    const reloaded = new TemplateLibrary(settings, new SettingsStore(settings, async () => undefined));
    expect(reloaded.isFavourite('classic-ruled')).toBe(true);
  });

  it('persists a candidate snapshot that already contains the requested mutation', async () => {
    const { library, persist } = createLibrary();
    await library.toggleFavourite('classic-ruled');
    const candidate = persist.mock.calls[0]?.[0] as TemplarSettings;
    expect(candidate.favouriteTemplateIds).toContain('classic-ruled');
  });

  it('removes a deleted custom template from favourites', async () => {
    const template: TemplarTemplate = {
      ...clone(BUILT_IN_TEMPLATES[0]!),
      id: 'my-style',
      name: 'My style',
      builtIn: false,
    };
    const { library } = createLibrary({ userTemplates: [template] });
    await library.toggleFavourite('my-style');
    expect(library.isFavourite('my-style')).toBe(true);
    await library.remove('my-style');
    expect(library.isFavourite('my-style')).toBe(false);
  });
});
