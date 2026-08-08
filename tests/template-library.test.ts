import { describe, expect, it, vi } from 'vitest';
import { TemplateLibrary } from '../src/services/template-library';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { clone } from '../src/utils/value';
import type { TemplarSettings, TemplarTemplate } from '../src/types';

function createLibrary(
  overrides: Partial<TemplarSettings> = {},
): { library: TemplateLibrary; settings: TemplarSettings; persist: ReturnType<typeof vi.fn> } {
  const settings = { ...clone(DEFAULT_SETTINGS), ...overrides };
  const persist = vi.fn(async () => undefined);
  return { library: new TemplateLibrary(settings, persist), settings, persist };
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
    await new TemplateLibrary(settings, async () => undefined).toggleFavourite('classic-ruled');
    const reloaded = new TemplateLibrary(settings, async () => undefined);
    expect(reloaded.isFavourite('classic-ruled')).toBe(true);
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
