import type {
  DefaultPageFlow,
  LibraryDensity,
  StyleRule,
  StyleRuleCondition,
  TemplarSettings,
} from '../types';
import {
  CURRENT_SETTINGS_DATA_VERSION,
  MAX_RULE_CONDITIONS,
  MAX_STYLE_RULES,
} from '../constants';
import { clone, numberValue, slugify, stringArray } from '../utils/value';
import { DEFAULT_SETTINGS } from './defaults';
import { inspectTemplateSchema, validateTemplateSource } from './schema';
import { validateCompleteTemplate } from './validation';

export type QuarantineKind =
  | 'invalid'
  | 'future-version'
  | 'unsupported-legacy'
  | 'migration-failed';

export type SettingsTemplateIssueKind = QuarantineKind;

export interface QuarantinedTemplate {
  index: number;
  templateId?: string;
  message: string;
  raw: unknown;
  kind: QuarantineKind;
}

export type SettingsLoadIssue = QuarantinedTemplate;

export interface SettingsNormalizationResult {
  settings: TemplarSettings;
  issues: SettingsLoadIssue[];
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function text(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function normalizeCondition(value: unknown): StyleRuleCondition | null {
  const source = record(value);
  if (source.type === 'folder') {
    const folder = text(source.folder).trim();
    return folder ? { type: 'folder', folder, includeSubfolders: source.includeSubfolders !== false } : null;
  }
  if (source.type === 'tag') {
    const tag = text(source.tag).trim().replace(/^#/, '');
    return tag ? { type: 'tag', tag } : null;
  }
  if (source.type === 'filename') {
    const valueText = text(source.value).trim();
    const operators = ['starts-with', 'ends-with', 'contains', 'exact'] as const;
    const operator = operators.includes(source.operator as typeof operators[number])
      ? source.operator as typeof operators[number]
      : 'contains';
    return valueText ? { type: 'filename', operator, value: valueText } : null;
  }
  if (source.type === 'frontmatter') {
    const property = text(source.property).trim();
    return property ? { type: 'frontmatter', property, value: text(source.value).trim() } : null;
  }
  return null;
}

export function normalizeStyleRules(value: unknown): StyleRule[] {
  if (!Array.isArray(value)) return [];
  const usedIds = new Set<string>();
  return value.slice(0, MAX_STYLE_RULES).flatMap((item, index) => {
    const source = record(item);
    const name = text(source.name, `Rule ${String(index + 1)}`).trim() || `Rule ${String(index + 1)}`;
    let id = slugify(text(source.id, name)) || `rule-${String(index + 1)}`;
    let suffix = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${String(suffix++)}`;
    usedIds.add(id);
    const conditions = Array.isArray(source.conditions)
      ? source.conditions
        .slice(0, MAX_RULE_CONDITIONS)
        .map(normalizeCondition)
        .filter((condition): condition is StyleRuleCondition => condition !== null)
      : [];
    const pageFlows = ['default', 'pageless', 'paged-a4', 'paged-letter'] as const;
    const pageFlow = pageFlows.includes(source.pageFlow as typeof pageFlows[number])
      ? source.pageFlow as typeof pageFlows[number]
      : 'default';
    const templateId = text(source.templateId).trim();
    return templateId && conditions.length > 0
      ? [{ id, name, enabled: source.enabled !== false, conditions, templateId, pageFlow }]
      : [];
  });
}

function normalizeIds(value: unknown, maximum: number): string[] {
  return [...new Set(stringArray(value, []).map((id) => id.trim()).filter(Boolean))]
    .slice(0, maximum);
}

function normalizeFontCacheSize(value: unknown): number {
  const clamped = numberValue(
    value,
    DEFAULT_SETTINGS.fontCacheSize,
    16,
    256,
  );
  return Math.min(256, Math.max(16, Math.round(clamped / 8) * 8));
}

function templateIdIfRecoverable(value: unknown): string | undefined {
  const source = record(value);
  const candidate = source.id ?? source['template-id'];
  return typeof candidate === 'string' && candidate.trim() ? candidate.trim() : undefined;
}

function normalizeUserTemplates(value: unknown): {
  templates: TemplarSettings['userTemplates'];
  issues: SettingsLoadIssue[];
} {
  if (!Array.isArray(value)) {
    return { templates: [], issues: [] };
  }
  const templates: TemplarSettings['userTemplates'] = [];
  const issues: SettingsLoadIssue[] = [];
  value.forEach((item, index) => {
    try {
      const inspected = inspectTemplateSchema(item);
      if (!inspected.value) {
        const kind = inspected.status === 'unsupported-future'
          ? 'future-version'
          : inspected.status === 'unsupported-legacy'
            ? 'unsupported-legacy'
            : inspected.status === 'migration-failed'
              ? 'migration-failed'
              : 'invalid';
        issues.push({
          index,
          ...(templateIdIfRecoverable(item) ? { templateId: templateIdIfRecoverable(item) } : {}),
          message: inspected.issues.map((issue) => issue.message).join(' ') || 'The saved template could not be interpreted.',
          raw: item,
          kind,
        });
        return;
      }
      const sourceIssues = validateTemplateSource(inspected.value);
      if (sourceIssues.some((issue) => issue.severity === 'error')) {
        throw new Error(sourceIssues
          .filter((issue) => issue.severity === 'error')
          .map((issue) => issue.message)
          .join(' '));
      }
      const template = inspected.value;
      const validation = validateCompleteTemplate(template);
      const errors = validation.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        throw new Error(errors.map((issue) => issue.message).join(' '));
      }
      templates.push(template);
    } catch (error) {
      issues.push({
        index,
        ...(templateIdIfRecoverable(item) ? { templateId: templateIdIfRecoverable(item) } : {}),
        message: error instanceof Error ? error.message : String(error),
        raw: item,
        kind: 'invalid',
      });
    }
  });
  return { templates, issues };
}

export function normalizeSettingsWithIssues(value: unknown): SettingsNormalizationResult {
  const source = record(value);
  const flows: DefaultPageFlow[] = ['pageless', 'paged-a4', 'paged-letter'];
  const densities: LibraryDensity[] = ['compact', 'comfortable', 'gallery'];
  const normalizedTemplates = normalizeUserTemplates(source.userTemplates);
  const settings: TemplarSettings = {
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    hideStyleMetadata: source.hideStyleMetadata !== false,
    defaultTemplateId: text(source.defaultTemplateId, DEFAULT_SETTINGS.defaultTemplateId),
    defaultGridUnit: Math.round(numberValue(
      source.defaultGridUnit,
      DEFAULT_SETTINGS.defaultGridUnit,
      16,
      60,
    )),
    fontCacheSize: normalizeFontCacheSize(source.fontCacheSize),
    favouriteTemplateIds: normalizeIds(source.favouriteTemplateIds, 256),
    recentTemplateIds: normalizeIds(source.recentTemplateIds, 10),
    defaultNewPageFlow: flows.includes(source.defaultNewPageFlow as DefaultPageFlow)
      ? source.defaultNewPageFlow as DefaultPageFlow
      : DEFAULT_SETTINGS.defaultNewPageFlow,
    libraryDensity: densities.includes(source.libraryDensity as LibraryDensity)
      ? source.libraryDensity as LibraryDensity
      : DEFAULT_SETTINGS.libraryDensity,
    styleRules: normalizeStyleRules(source.styleRules),
    userTemplates: normalizedTemplates.templates,
  };
  return { settings, issues: normalizedTemplates.issues };
}

export function normalizeSettings(value: unknown): TemplarSettings {
  return normalizeSettingsWithIssues(value).settings;
}

/*
 * Keep the old object-shape documentation close to the implementation. The
 * explicit assignment above is intentional: future or unknown data keys must
 * not become live settings merely because they were present in data.json.
 */
export function cloneSettings(value: TemplarSettings): TemplarSettings {
  return {
    enableReadingView: value.enableReadingView,
    enableLivePreview: value.enableLivePreview,
    hideStyleMetadata: value.hideStyleMetadata,
    defaultTemplateId: value.defaultTemplateId,
    defaultGridUnit: value.defaultGridUnit,
    fontCacheSize: value.fontCacheSize,
    favouriteTemplateIds: [...value.favouriteTemplateIds],
    recentTemplateIds: [...value.recentTemplateIds],
    defaultNewPageFlow: value.defaultNewPageFlow,
    libraryDensity: value.libraryDensity,
    styleRules: clone(value.styleRules),
    userTemplates: clone(value.userTemplates),
  };
}

export function settingsToPersistedData(
  settings: TemplarSettings,
  quarantined: readonly QuarantinedTemplate[] = [],
): Record<string, unknown> {
  return {
    'settings-data-version': CURRENT_SETTINGS_DATA_VERSION,
    enableReadingView: settings.enableReadingView,
    enableLivePreview: settings.enableLivePreview,
    hideStyleMetadata: settings.hideStyleMetadata,
    defaultTemplateId: settings.defaultTemplateId,
    defaultGridUnit: settings.defaultGridUnit,
    fontCacheSize: settings.fontCacheSize,
    favouriteTemplateIds: [...settings.favouriteTemplateIds],
    recentTemplateIds: [...settings.recentTemplateIds],
    defaultNewPageFlow: settings.defaultNewPageFlow,
    libraryDensity: settings.libraryDensity,
    styleRules: clone(settings.styleRules),
    userTemplates: [
      ...clone(settings.userTemplates),
      ...quarantined.map((entry) => clone(entry.raw)),
    ],
  };
}
