import { describe, expect, it } from 'vitest';
import { RecoveryService } from '../src/services/recovery-service';
import { inspectRawNoteStyle } from '../src/services/style-inspection';
import type { App, TFile } from 'obsidian';

function testFile<T>(path: string): T {
  return { path, basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path } as T;
}

function setup() {
  const files = new Map<string, { kind: 'folder' | 'file'; data?: string }>();
  const app = {
    vault: {
      getAbstractFileByPath: (path: string) => {
        const entry = files.get(path);
        if (!entry) return null;
        return entry.kind === 'folder' ? { path, children: [] } : { path };
      },
      createFolder: async (path: string) => {
        files.set(path, { kind: 'folder' });
        return { path, children: [] };
      },
      create: async (path: string, data: string) => {
        files.set(path, { kind: 'file', data });
        return { path };
      },
    },
  } as unknown as App;
  return { app, files };
}

describe('RecoveryService', () => {
  it('creates a unique vault recovery artifact containing raw data', async () => {
    const harness = setup();
    const service = new RecoveryService(harness.app, '1.2.0');
    const file = testFile<TFile>('Notes/research-note.md');
    const inspection = inspectRawNoteStyle({ version: 2, preserved: true });
    const first = await service.backupNoteStyle(file, inspection, 'unsupported-future');
    const second = await service.backupNoteStyle(file, inspection, 'unsupported-future');
    expect(first).not.toBe(second);
    expect([...harness.files.values()].filter((entry) => entry.kind === 'file')).toHaveLength(2);
    const record = [...harness.files.values()].find((entry) => entry.data)?.data;
    expect(record).toContain('"sourcePath": "Notes/research-note.md"');
    expect(record).toContain('"preserved": true');
  });

  it('fails when a folder component is a file', async () => {
    const harness = setup();
    harness.files.set('Templar Recovery', { kind: 'file' });
    const service = new RecoveryService(harness.app, '1.2.0');
    await expect(service.backupSettings({ legacy: true })).rejects.toThrow('file, not a folder');
  });

  it('refuses recovery records above the size limit', async () => {
    const harness = setup();
    const service = new RecoveryService(harness.app, '1.2.0');
    await expect(service.backupSettings({ huge: 'x'.repeat(8_000_001) })).rejects.toThrow('recovery limit');
    expect([...harness.files.keys()]).toEqual([]);
  });
});
