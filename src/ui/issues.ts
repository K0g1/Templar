import type { ValidationIssue } from '../types';

export function renderIssues(container: HTMLElement, issues: ValidationIssue[]): void {
  container.empty();
  if (issues.length === 0) {
    container.createDiv({
      cls: 'templar-validation templar-validation--success',
      text: '✓ Template is valid and safely scoped.',
    });
    return;
  }

  const list = container.createDiv({ cls: 'templar-validation-list' });
  for (const issue of issues) {
    const item = list.createDiv({
      cls: `templar-validation templar-validation--${issue.severity}`,
    });
    item.createEl('strong', {
      text: issue.severity === 'error' ? 'Problem: ' : `${capitalize(issue.severity)}: `,
    });
    item.appendText(issue.message);
    if (issue.fix) {
      item.createDiv({ cls: 'templar-validation-fix', text: issue.fix });
    }
  }
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
