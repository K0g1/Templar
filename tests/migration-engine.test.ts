import { describe, expect, it } from 'vitest';
import { migrateVersionedRecord } from '../src/migrations/engine';
import type { MigrationStep } from '../src/migrations/types';

const steps: MigrationStep[] = [
  {
    id: 'one-to-two',
    from: 1,
    to: 2,
    migrate: (raw) => ({ ...raw, version: 2, first: true }),
  },
  {
    id: 'two-to-three',
    from: 2,
    to: 3,
    migrate: (raw) => ({ ...raw, version: 3, second: true }),
  },
];

const options = {
  currentVersion: 3,
  minimumSupportedVersion: 1,
  steps,
  normalizeCurrent: (raw: unknown) => raw as { version: number },
};

describe('versioned migration engine', () => {
  it('normalizes current data without a migration trace', () => {
    const result = migrateVersionedRecord({ version: 3, value: 'ok' }, options);
    expect(result.status).toBe('current');
    expect(result.trace).toEqual([]);
    expect(result.value).toMatchObject({ version: 3, value: 'ok' });
  });

  it('runs contiguous steps in order without mutating the input', () => {
    const raw = { version: 1, nested: { value: 1 } };
    const result = migrateVersionedRecord(raw, options);
    expect(result.status).toBe('migrated');
    expect(result.trace.map((step) => step.id)).toEqual(['one-to-two', 'two-to-three']);
    expect(result.migratedRaw).toMatchObject({ version: 3, first: true, second: true });
    expect(raw).toEqual({ version: 1, nested: { value: 1 } });
  });

  it('protects future, legacy, missing, fractional, and non-positive versions', () => {
    expect(migrateVersionedRecord({ version: 4 }, options).status).toBe('unsupported-future');
    expect(migrateVersionedRecord({ version: 1 }, {
      ...options,
      minimumSupportedVersion: 2,
    }).status).toBe('unsupported-legacy');
    expect(migrateVersionedRecord({ version: 0 }, options).status).toBe('invalid');
    expect(migrateVersionedRecord({ version: -1 }, options).status).toBe('invalid');
    expect(migrateVersionedRecord({ version: 1.5 }, options).status).toBe('invalid');
    expect(migrateVersionedRecord({ version: '1' }, options).status).toBe('invalid');
    expect(migrateVersionedRecord({}, options).issues[0]?.code).toBe('missing-version');
  });

  it('reports missing steps and wrong output versions', () => {
    const missing = migrateVersionedRecord({ version: 1 }, {
      ...options,
      steps: [steps[1]!],
    });
    expect(missing.status).toBe('migration-failed');
    expect(missing.issues[0]?.code).toBe('missing-migration-step');

    const wrong = migrateVersionedRecord({ version: 1 }, {
      ...options,
      steps: [{ ...steps[0]!, migrate: (raw) => ({ ...raw, version: 99 }) }],
    });
    expect(wrong.status).toBe('migration-failed');
    expect(wrong.issues[0]?.code).toBe('wrong-output-version');
  });

  it('classifies normalizer failures as invalid', () => {
    const result = migrateVersionedRecord({ version: 3 }, {
      ...options,
      normalizeCurrent: () => { throw new Error('bad shape'); },
    });
    expect(result.status).toBe('invalid');
    expect(result.issues[0]?.code).toBe('validation-failed');
  });
});
