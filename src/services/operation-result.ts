export type FileOperationStatus = 'pending' | 'succeeded' | 'failed' | 'skipped';

export interface FileOperationResult {
  path: string;
  status: FileOperationStatus;
  message?: string;
}

export interface BatchOperationSummary {
  results: FileOperationResult[];
  succeeded: number;
  failed: number;
  skipped: number;
}

export function summarizeFileOperations(results: readonly FileOperationResult[]): BatchOperationSummary {
  return {
    results: [...results],
    succeeded: results.filter((result) => result.status === 'succeeded').length,
    failed: results.filter((result) => result.status === 'failed').length,
    skipped: results.filter((result) => result.status === 'skipped').length,
  };
}
