import type { BatchOperationSummary } from '../services/operation-result';

export function renderOperationSummary(
  container: HTMLElement,
  summary: BatchOperationSummary,
  options: { showPaths?: boolean } = {},
): void {
  container.empty();
  container.createEl('h4', { text: 'Operation results' });
  container.createDiv({
    cls: 'templar-operation-summary-counts',
    text: `Succeeded: ${String(summary.succeeded)} · Failed: ${String(summary.failed)} · Skipped: ${String(summary.skipped)} · Warnings: ${String(summary.warnings)}`,
  });

  const visibleResults = summary.results.filter((result) =>
    result.status !== 'succeeded' || result.warnings.length > 0,
  );
  if (options.showPaths && visibleResults.length > 0) {
    const list = container.createEl('ul', { cls: 'templar-operation-results' });
    for (const result of visibleResults) {
      const details = result.warnings.map((warning) => warning.message).join(' ');
      const suffix = result.message ? ` ${result.message}` : '';
      list.createEl('li', {
        text: `${result.status}: ${result.path}${suffix}${details ? ` ${details}` : ''}`,
      });
    }
  }
}
