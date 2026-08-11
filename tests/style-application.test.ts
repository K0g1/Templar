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

function harness(options: {
  failPath?: string;
  recentFailure?: boolean;
  refreshFailure?: boolean;
  indexFailure?: boolean;
  deletedPaths?: string[];
} = {}) {
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
    update: vi.fn(() => {
      if (options.indexFailure) throw new Error('index unavailable');
    }),
  };
  const library = {
    recordRecent: vi.fn(async () => {
      if (options.recentFailure) throw new Error('settings write failed');
    }),
  };
  const refreshFile = vi.fn(async () => {
    if (options.refreshFailure) throw new Error('renderer unavailable');
  });
  const refreshDeferred = vi.fn();
  const service = new StyleApplicationService({
    frontmatter,
    library,
    usageIndex,
    settings: { defaultNewPageFlow: 'pageless' },
    refreshFile,
    refreshDeferred,
    getCurrentFile: (path: string) => options.deletedPaths?.includes(path) ? null : file(path),
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
    expect(result.warnings[0]?.stage).toBe('recent');
    expect(result.warnings[0]?.message).toContain('Recent could not be saved');
    expect(setup.frontmatter.applyTemplate).toHaveBeenCalledOnce();
    expect(setup.refreshFile).toHaveBeenCalledWith(target);
    expect(setup.usageIndex.update).toHaveBeenCalledOnce();
  });

  it('reports refresh failure as a warning after a successful write', async () => {
    const setup = harness({ refreshFailure: true });
    const result = await setup.service.apply({ file: file('Notes/one.md'), template: BUILT_IN_TEMPLATES[0]! });
    expect(result).toMatchObject({ status: 'succeeded', noteWritten: true, refreshed: false });
    expect(result.warnings[0]?.stage).toBe('refresh');
  });

  it('reports index failure as a warning after a successful write', async () => {
    const setup = harness({ indexFailure: true });
    const result = await setup.service.apply({ file: file('Notes/one.md'), template: BUILT_IN_TEMPLATES[0]! });
    expect(result).toMatchObject({ status: 'succeeded', noteWritten: true });
    expect(result.warnings[0]?.stage).toBe('index');
  });

  it('propagates a failed frontmatter write without reporting a note write', async () => {
    const setup = harness({ failPath: 'Notes/fail.md' });
    await expect(setup.service.apply({ file: file('Notes/fail.md'), template: BUILT_IN_TEMPLATES[0]! })).rejects.toThrow('frontmatter write failed');
  });

  it('returns per-file outcomes and defers one final refresh for batch application', async () => {
    const setup = harness({ failPath: 'Notes/fail.md' });
    const files = [file('Notes/ok.md'), file('Notes/fail.md'), file('Notes/second.md')];
    const summary = await setup.service.applyBatch({
      files,
      template: BUILT_IN_TEMPLATES[1]!,
      resolvePageOptions: () => ({ mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true }),
    });

    expect(summary.results.map((result) => result.status)).toEqual(['succeeded', 'failed', 'succeeded']);
    expect(summary.results[1]?.message).toBe('frontmatter write failed');
    expect(setup.refreshFile).not.toHaveBeenCalled();
    expect(setup.refreshDeferred).toHaveBeenCalledOnce();
    expect(summary).toMatchObject({ succeeded: 2, failed: 1, skipped: 0, warnings: 0 });
    expect(summarizeFileOperations(summary.results)).toMatchObject({ succeeded: 2, failed: 1, skipped: 0, warnings: 0 });
  });

  it('skips deleted targets and schedules no refresh when no note is written', async () => {
    const setup = harness({ deletedPaths: ['Notes/gone.md'] });
    const summary = await setup.service.applyBatch({
      files: [file('Notes/gone.md')],
      template: BUILT_IN_TEMPLATES[0]!,
      resolvePageOptions: () => ({ mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true }),
    });
    expect(summary).toMatchObject({ succeeded: 0, failed: 0, skipped: 1, warnings: 0 });
    expect(setup.refreshDeferred).not.toHaveBeenCalled();
  });

  it('yields to the host after each configured chunk', async () => {
    const setup = harness();
    const yieldToHost = vi.fn(async () => undefined);
    const summary = await setup.service.applyBatch({
      files: [file('Notes/one.md'), file('Notes/two.md'), file('Notes/three.md')],
      template: BUILT_IN_TEMPLATES[0]!,
      yieldEvery: 2,
      yieldToHost,
      resolvePageOptions: () => ({ mode: 'pageless', size: 'a4', width: 794, height: 1123, gap: 32, scaleToFit: true }),
    });
    expect(summary.succeeded).toBe(3);
    expect(yieldToHost).toHaveBeenCalledOnce();
  });
});
