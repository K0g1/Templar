import { parsedObjectToTemplate, templateToExportObject } from '../templates/note-format';
import {
  CURRENT_PACK_FORMAT_VERSION,
  MIN_SUPPORTED_PACK_FORMAT_VERSION,
  MAX_IMPORT_BYTES,
  MAX_PACK_TEMPLATES,
} from '../constants';
import { migrateVersionedRecord } from '../migrations/engine';
import { PACK_MIGRATIONS } from '../migrations/pack-migrations';
import type { MigrationIssue, SchemaMigrationResult } from '../migrations/types';
import { inspectTemplateSchema } from '../templates/schema';
import { validateTemplate, validateTemplateSource } from '../templates/schema';
import { DEFAULT_TEMPLATE } from '../templates/defaults';
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

function normalizeCurrentPack(
  source: Record<string, unknown>,
  memberIssues: MigrationIssue[],
): TemplarPack {
  if (!Array.isArray(source.templates)) {
    throw new Error('The template pack is missing its templates list.');
  }
  if (source.templates.length > MAX_PACK_TEMPLATES) {
    throw new Error(`A Templar pack may contain at most ${String(MAX_PACK_TEMPLATES)} templates.`);
  }
  const templates: TemplarTemplate[] = [];
  const entries = source.templates as unknown[];
  entries.forEach((entry, index) => {
    const entryRecord = record(entry);
    const wrapped: unknown = entryRecord['templar-template'] !== undefined
      ? entryRecord['templar-template']
      : entry;
    const inspected = inspectTemplateSchema(wrapped);
    if (inspected.value) {
      templates.push(inspected.value);
    } else {
      memberIssues.push(...inspected.issues.map((issue) => ({
        ...issue,
        code: 'validation-failed' as const,
        message: `templates[${String(index)}]: ${issue.message}`,
      })));
    }
  });
  return {
    version: CURRENT_PACK_FORMAT_VERSION,
    name: typeof source.name === 'string' && source.name.trim() ? source.name.trim() : 'Untitled Templar pack',
    description: typeof source.description === 'string' ? source.description.trim() : '',
    author: typeof source.author === 'string' ? source.author.trim() : '',
    tags: stringArray(source.tags, []),
    templates,
  };
}

export function inspectTemplatePackSchema(raw: unknown): SchemaMigrationResult<TemplarPack> {
  const root = record(raw);
  const source = record(root['templar-pack']);
  const memberIssues: MigrationIssue[] = [];
  const result = migrateVersionedRecord(source, {
    currentVersion: CURRENT_PACK_FORMAT_VERSION,
    minimumSupportedVersion: MIN_SUPPORTED_PACK_FORMAT_VERSION,
    steps: PACK_MIGRATIONS,
    normalizeCurrent: (value) => normalizeCurrentPack(value as Record<string, unknown>, memberIssues),
  });
  result.issues.push(...memberIssues);
  return result;
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

export function parseTemplatePack(raw: unknown): PackReview | null {
  const root = record(raw);
  const rawSource = record(root['templar-pack']);
  if (Object.keys(rawSource).length === 0) return null;
  const inspectedPack = inspectTemplatePackSchema(raw);
  if (!inspectedPack.value) {
    throw new Error(inspectedPack.issues.map((issue) => issue.message).join(' ') || 'This template pack uses an unsupported format version.');
  }
  // Wrapper migrations can rename or reshape the member list. Current
  // wrappers use their raw value, while supported old wrappers must feed the
  // migrated record into independent member inspection below.
  const source = inspectedPack.migratedRaw ?? rawSource;
  if (!Array.isArray(source.templates)) throw new Error('The template pack is missing its templates list.');
  if (source.templates.length > MAX_PACK_TEMPLATES) {
    throw new Error(`A Templar pack may contain at most ${String(MAX_PACK_TEMPLATES)} templates.`);
  }
  const templates = source.templates.map((entry: unknown, index: number): PackTemplateReview => {
    const wrapped: unknown = record(entry)['templar-template'] !== undefined ? entry : { 'templar-template': entry };
    const inspected = inspectTemplateSchema(wrapped);
    if (!inspected.value) {
      const blocked = clone(DEFAULT_TEMPLATE);
      blocked.id = `blocked-template-${String(index + 1)}`;
      return {
        template: blocked,
        issues: inspected.issues.map((issue) => ({
          severity: 'error' as const,
          path: 'templar-pack.templates',
          message: issue.message,
        })),
        valid: false,
      };
    }
    const template = parsedObjectToTemplate(inspected.value);
    template.builtIn = false;
    const issues = [
      ...validateTemplateSource(inspected.value),
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
    version: inspectedPack.value.version,
    name: inspectedPack.value.name,
    description: inspectedPack.value.description,
    author: inspectedPack.value.author,
    tags: inspectedPack.value.tags,
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
      version: CURRENT_PACK_FORMAT_VERSION,
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
