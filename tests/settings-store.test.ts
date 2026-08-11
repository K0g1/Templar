import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';
import { SettingsStore } from '../src/services/settings-store';
import { clone } from '../src/utils/value';

describe('SettingsStore', () => {
  it('does not publish a candidate when persistence rejects', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    const before = clone(settings);
    const persist = vi.fn(async () => { throw new Error('disk full'); });
    const store = new SettingsStore(settings, persist);

    await expect(store.transaction((draft) => {
      draft.defaultGridUnit = 55;
    })).rejects.toThrow('disk full');

    expect(settings).toEqual(before);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it('continues with later transactions after a rejection', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    let attempts = 0;
    const store = new SettingsStore(settings, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('first failure');
    });

    const first = store.transaction((draft) => { draft.defaultGridUnit = 50; });
    const second = store.transaction((draft) => { draft.defaultGridUnit = 51; });
    await expect(first).rejects.toThrow('first failure');
    await expect(second).resolves.toBeUndefined();
    expect(settings.defaultGridUnit).toBe(51);
  });

  it('serializes transactions and commits in request order', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    const order: string[] = [];
    const store = new SettingsStore(settings, async (candidate) => {
      order.push(`persist:${String(candidate.defaultGridUnit)}`);
      await Promise.resolve();
    });
    const first = store.transaction((draft) => {
      draft.defaultGridUnit = 40;
      return 'first';
    });
    const second = store.transaction((draft) => {
      draft.defaultGridUnit = 41;
      return 'second';
    });

    await expect(first).resolves.toBe('first');
    await expect(second).resolves.toBe('second');
    expect(order).toEqual(['persist:40', 'persist:41']);
    expect(settings.defaultGridUnit).toBe(41);
  });

  it('keeps the committed settings object identity', async () => {
    const settings = clone(DEFAULT_SETTINGS);
    const store = new SettingsStore(settings, async () => undefined);
    const reference = store.current;
    await store.transaction((draft) => { draft.enableLivePreview = false; });
    expect(store.current).toBe(reference);
    expect(settings).toBe(reference);
    expect(settings.enableLivePreview).toBe(false);
  });
});
