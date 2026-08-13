export type FileOperationStatus = 'succeeded' | 'failed' | 'skipped';

export interface FileOperationWarning {
  stage: 'index' | 'recent' | 'refresh' | 'ui';
  message: string;
}

export interface FileOperationResult {
  path: string;
  status: FileOperationStatus;
  noteWritten: boolean;
  refreshed: boolean;
  warnings: FileOperationWarning[];
  message?: string;
}

export interface BatchOperationSummary {
  results: FileOperationResult[];
  succeeded: number;
  failed: number;
  skipped: number;
  warnings: number;
}

export function mergeOperationResults(
  previous: readonly FileOperationResult[],
  retry: readonly FileOperationResult[],
): FileOperationResult[] {
  const retryByPath = new Map(retry.map((result) => [result.path, result]));
  const merged = previous.map((result) => retryByPath.get(result.path) ?? result);
  const existing = new Set(previous.map((result) => result.path));
  for (const result of retry) {
    if (!existing.has(result.path)) merged.push(result);
  }
  return merged.map((result) => ({ ...result, warnings: [...result.warnings] }));
}

export function summarizeFileOperations(results: readonly FileOperationResult[]): BatchOperationSummary {
  return {
    results: [...results],
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
    warnings: results.reduce((count, result) => count + result.warnings.length, 0),
  };
}
