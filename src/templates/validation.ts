import type { TemplarTemplate, ValidationIssue, ValidationResult } from '../types';
import { validateCustomCss } from '../services/css-validator';
import { validateTemplate } from './schema';

/** The one complete-template validation contract shared by core workflows. */
export function validateCompleteTemplate(template: TemplarTemplate): ValidationIssue[] {
  return [
    ...validateTemplate(template).issues,
    ...validateCustomCss(template.css, {
      protectRhythm: template.baseline.enabled && template.baseline.mode !== 'free',
    }).issues,
  ];
}

export function completeTemplateValidation(template: TemplarTemplate): ValidationResult {
  const issues = validateCompleteTemplate(template);
  return { valid: !issues.some((issue) => issue.severity === 'error'), issues };
}
