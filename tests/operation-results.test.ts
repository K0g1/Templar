import { describe, expect, it } from 'vitest';
import { Notice } from 'obsidian';
import { mergeOperationResults, summarizeFileOperations, type FileOperationResult } from '../src/services/operation-result';
import { reportSingleFileOperation } from '../src/ui/async-actions';

function result(path: string, status: FileOperationResult['status']): FileOperationResult {
  return { path, status, noteWritten: status === 'succeeded', refreshed: false, warnings: [] };
}

describe('operation result aggregation', () => {
  it('reports one success notice plus each deterministic post-write warning', () => {
    const noticeHarness = Notice as unknown as { messages: string[] };
    noticeHarness.messages.length = 0;
    reportSingleFileOperation({
      ...result('a.md', 'succeeded'),
      warnings: [
        { stage: 'index', message: 'Index warning' },
        { stage: 'refresh', message: 'Refresh warning' },
      ],
    }, 'Saved style.');
    expect(noticeHarness.messages).toEqual(['Saved style.', 'Index warning', 'Refresh warning']);
  });

  it('replaces retry paths while preserving order and untouched successes', () => {
    const merged = mergeOperationResults(
      [result('a.md', 'succeeded'), result('b.md', 'failed'), result('c.md', 'skipped')],
      [result('b.md', 'succeeded')],
    );
    expect(merged.map((entry) => `${entry.path}:${entry.status}`)).toEqual([
      'a.md:succeeded', 'b.md:succeeded', 'c.md:skipped',
    ]);
    expect(summarizeFileOperations(merged).skipped).toBe(1);
  });
});
