import { describe, expect, it } from 'vitest';
import { mergeOperationResults, summarizeFileOperations, type FileOperationResult } from '../src/services/operation-result';

function result(path: string, status: FileOperationResult['status']): FileOperationResult {
  return { path, status, noteWritten: status === 'succeeded', refreshed: false, warnings: [] };
}

describe('operation result aggregation', () => {
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
