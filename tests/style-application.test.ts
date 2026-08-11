import type { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { StyleApplicationService } from '../src/services/style-application';
import { summarizeFileOperations } from '../src/services/operation-result';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import type { TemplarNoteStyle } from '../src/types';

function file(path: string): TFile {
  return {
    path,
    basename: path.split('/').pop()?.replace(/\.md$/, '') ?? path,
    parent: { path: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '' },
  } as TFile;
}

function harness(options: { failPath?: string; recentFailure?: boolean } = {}) {
  const frontmatter = {
    getStyle: vi.fn((_target: TFile): TemplarNoteStyle | null => null),
    applyTemplate: vi.fn(async (target: TFile) => {
      if (target.path === options.failPath) throw new Error('frontmatter write failed');
    }),
    writeStyle: vi.fn(async () => undefined),
    patchPageOptions: vi.fn(async () => undefined),
    removeStyle: vi.fn(async () => undefined),
  };
  const usageIndex = {
    isBuilt: vi.fn(() => true),
    update: vi.fn(),
  };
  const library = {
    recordRecent: vi.fn(async () => {
      if (options.recentFailure) throw new Error('settings write failed');
    }),
  };
  const refreshFile = vi.fn(async () => undefined);
  const refreshDeferred = vi.fn();
  const service = new StyleApplicationService({
    frontmatter,
    library,
    usageIndex,
    settings: { defaultNewPageFlow: 'pageless' },
    refreshFile,
    refreshDeferred,
  } as never);
  return { service, frontmatter, usageIndex, library, refreshFile, refreshDeferred };
}

describe('StyleApplicationService', () => {
  it('keeps a successful note write when recent-history persistence fails', async () => {
    const target = file('Notes/one.md');
    const setup = harness({ recentFailure: true });
    const result = await setup.service.apply({
      file: target,
      template: BUILT_IN_TEMPLATES[0]!,
    });

    expect(result.noteWritten).toBe(true);
    expect(result.recentRecorded).toBe(false);
    expect(result.warnings[0]).toContain('Recent could not be saved');
    expect(setup.frontmatter.applyTemplate).toHaveBeenCalledOnce();
    expect(setup.refreshFile).toHaveBeenCalledWith(target);
    expect(setup.usageIndex.update).toHaveBeenCalledOnce();
  });

  it('returns per-file outcomes and defers one refresh for batch application', async () => {
    const setup = harness({ failPath: 'Notes/fail.md' });
    const files = [file('Notes/ok.md'), file('Notes/fail.md'), file('Notes/second.md')];
    const results = await setup.service.applyBatch(
      files,
      BUILT_IN_TEMPLATES[1]!,
      () => ({ mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true }),
    );

    expect(results.map((result) => result.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(results[1]?.message).toBe('frontmatter write failed');
    expect(setup.refreshFile).not.toHaveBeenCalled();
    expect(setup.refreshDeferred).toHaveBeenCalledTimes(3);
    expect(summarizeFileOperations(results)).toMatchObject({ succeeded: 2, failed: 1, skipped: 0 });
  });
});
