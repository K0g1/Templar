import { Notice } from 'obsidian';
import type { FileOperationResult } from '../services/operation-result';

export function showOperationWarnings(result: FileOperationResult): void {
  for (const warning of result.warnings) new Notice(warning.message);
}

export function runUserAction(action: () => Promise<void>, context: string): void {
  void action().catch((error: unknown) => {
    new Notice(`${context}: ${error instanceof Error ? error.message : String(error)}`);
  });
}

export function runBackgroundTask(action: () => Promise<void>, context: string): void {
  void action().catch((error: unknown) => {
    console.error(`[Templar] ${context}`, error);
  });
}
