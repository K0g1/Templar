import { describe, expect, it } from 'vitest';
import { loadVersionedSettings } from '../src/migrations/settings-loader';
import { settingsToPersistedData } from '../src/templates/settings';
import { DEFAULT_SETTINGS } from '../src/templates/defaults';

describe('settings data versioning', () => {
  it('loads legacy flat settings in memory without changing values', () => {
    const result = loadVersionedSettings({ enableReadingView: false, defaultGridUnit: 42 });
    expect(result.status).toBe('migrated');
    expect(result.rawVersion).toBeNull();
    expect(result.settings.enableReadingView).toBe(false);
    expect(result.settings.defaultGridUnit).toBe(42);
    expect(result.migrationTrace[0]).toMatchObject({ from: 0, to: 1 });
  });

  it('loads current settings and protects future settings raw', () => {
    expect(loadVersionedSettings({ 'settings-data-version': 1 }).status).toBe('current');
    const future = loadVersionedSettings({ 'settings-data-version': 2, custom: true });
    expect(future.status).toBe('unsupported-future');
    expect(future.settings).toEqual(DEFAULT_SETTINGS);
    expect(future.protectedRaw).toEqual({ 'settings-data-version': 2, custom: true });
  });

  it.each([undefined, null])('treats %s as a safe first-install state', (raw) => {
    const result = loadVersionedSettings(raw);
    expect(result.status).toBe('current');
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
    expect(result.protectedRaw).toBeUndefined();
  });

  it.each(['bad', 123, [], [{}]])('protects non-null malformed settings data', (raw) => {
    const result = loadVersionedSettings(raw);
    expect(result.status).toBe('invalid');
    expect(result.protectedRaw).toEqual(raw);
    expect(result.settings).toEqual(DEFAULT_SETTINGS);
  });

  it('serializes flat current settings and raw quarantined entries', () => {
    const data = settingsToPersistedData(DEFAULT_SETTINGS, [{
      index: 0,
      raw: { version: 2, id: 'future' },
      message: 'future',
      kind: 'future-version',
    }]);
    expect(data['settings-data-version']).toBe(1);
    expect(data.userTemplates).toEqual([{ version: 2, id: 'future' }]);
  });
});
