import type { MigrationStep } from './types';

export const SETTINGS_MIGRATIONS: readonly MigrationStep[] = [
  {
    id: 'settings-0-to-1',
    from: 0,
    to: 1,
    migrate: (raw) => {
      const copy = { ...raw };
      delete copy.version;
      copy['settings-data-version'] = 1;
      return copy;
    },
  },
];
