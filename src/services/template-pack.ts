import { parsedObjectToTemplate, templateToExportObject } from '../templates/note-format';
import { MAX_IMPORT_BYTES, MAX_PACK_TEMPLATES } from '../constants';
import { validateTemplate, validateTemplateSource } from '../templates/schema';
import type { TemplarPack, TemplarTemplate, ValidationIssue } from '../types';
import { clone, slugify, stringArray } from '../utils/value';
import { validateCustomCss } from './css-validator';

export interface PackTemplateReview {
  template: TemplarTemplate;
  issues: ValidationIssue[];
  valid: boolean;
}

export interface PackReview {
  pack: TemplarPack;
  templates: PackTemplateReview[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseTemplatePack(raw: unknown): PackReview | null {
  const root = record(raw);
  const source = record(root['templar-pack']);
  if (Object.keys(source).length === 0) return null;
  if (source.version !== 1) throw new Error('This template pack uses an unsupported format version.');
  if (!Array.isArray(source.templates)) throw new Error('The template pack is missing its templates list.');
  if (source.templates.length > MAX_PACK_TEMPLATES) {
    throw new Error(`A Templar pack may contain at most ${String(MAX_PACK_TEMPLATES)} templates.`);
  }
  const templates = source.templates.map((entry: unknown): PackTemplateReview => {
    const wrapped: unknown = record(entry)['templar-template'] !== undefined ? entry : { 'templar-template': entry };
    const template = parsedObjectToTemplate(wrapped);
    template.builtIn = false;
    const issues = [
      ...validateTemplateSource(wrapped),
      ...validateTemplate(template).issues,
      ...validateCustomCss(template.css, {
        protectRhythm: template.baseline.enabled && template.baseline.mode !== 'free',
      }).issues,
    ];
    return { template, issues, valid: !issues.some((issue) => issue.severity === 'error') };
  });
  const aggregateCssBytes = templates.reduce(
    (total, entry) => total + new Blob([entry.template.css]).size,
    0,
  );
  if (aggregateCssBytes > MAX_IMPORT_BYTES) {
    throw new Error('The combined template CSS in this pack exceeds the 8 MB import limit.');
  }
  const idCounts = new Map<string, number>();
  for (const entry of templates) {
    idCounts.set(entry.template.id, (idCounts.get(entry.template.id) ?? 0) + 1);
  }
  for (const entry of templates) {
    if ((idCounts.get(entry.template.id) ?? 0) <= 1) continue;
    entry.issues.push({
      severity: 'error',
      path: 'templar-pack.templates.template-id',
      message: `The pack contains the duplicate template ID “${entry.template.id}”.`,
      fix: 'Give every template in a pack a unique ID before importing.',
    });
    entry.valid = false;
  }
  const pack: TemplarPack = {
    version: 1,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Untitled Templar pack',
    description: typeof source.description === 'string' ? source.description.trim() : '',
    author: typeof source.author === 'string' ? source.author.trim() : '',
    tags: stringArray(source.tags, []),
    templates: templates.map(({ template }) => clone(template)),
  };
  return { pack, templates };
}

export function templatePackToExportObject(
  metadata: Omit<TemplarPack, 'version' | 'templates'>,
  templates: readonly TemplarTemplate[],
): Record<string, unknown> {
  return {
    'templar-pack': {
      version: 1,
      name: metadata.name.trim() || 'Untitled Templar pack',
      description: metadata.description.trim(),
      author: metadata.author.trim(),
      tags: [...metadata.tags],
      templates: templates.map((template) => templateToExportObject(template)['templar-template']),
    },
  };
}

export function uniqueCopyId(preferred: string, usedIds: ReadonlySet<string>): string {
  const base = slugify(`${preferred}-copy`);
  if (!usedIds.has(base)) return base;
  let suffix = 2;
  while (usedIds.has(`${base}-${String(suffix)}`)) suffix += 1;
  return `${base}-${String(suffix)}`;
}
