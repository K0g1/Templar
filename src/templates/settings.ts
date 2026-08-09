import type {
  DefaultPageFlow,
  LibraryDensity,
  StyleRule,
  StyleRuleCondition,
  TemplarSettings,
} from '../types';
import { clone, slugify, stringArray } from '../utils/value';
import { DEFAULT_SETTINGS } from './defaults';
import { normalizeTemplate } from './schema';

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
  return value.flatMap((item, index) => {
    const source = record(item);
    const name = text(source.name, `Rule ${String(index + 1)}`).trim() || `Rule ${String(index + 1)}`;
    let id = slugify(text(source.id, name)) || `rule-${String(index + 1)}`;
    let suffix = 2;
    const base = id;
    while (usedIds.has(id)) id = `${base}-${String(suffix++)}`;
    usedIds.add(id);
    const conditions = Array.isArray(source.conditions)
      ? source.conditions.map(normalizeCondition).filter((condition): condition is StyleRuleCondition => condition !== null)
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

export function normalizeSettings(value: unknown): TemplarSettings {
  const source = record(value);
  const flows: DefaultPageFlow[] = ['pageless', 'paged-a4', 'paged-letter'];
  const densities: LibraryDensity[] = ['compact', 'comfortable', 'gallery'];
  const userTemplates = Array.isArray(source.userTemplates)
    ? source.userTemplates.map((template) => normalizeTemplate(template))
    : [];
  const recent = [...new Set(stringArray(source.recentTemplateIds, []))].slice(0, 10);
  return {
    ...clone(DEFAULT_SETTINGS),
    ...source,
    enableReadingView: source.enableReadingView !== false,
    enableLivePreview: source.enableLivePreview !== false,
    hideStyleMetadata: source.hideStyleMetadata !== false,
    defaultTemplateId: text(source.defaultTemplateId, DEFAULT_SETTINGS.defaultTemplateId),
    defaultGridUnit: typeof source.defaultGridUnit === 'number'
      ? source.defaultGridUnit
      : DEFAULT_SETTINGS.defaultGridUnit,
    fontCacheSize: typeof source.fontCacheSize === 'number'
      ? source.fontCacheSize
      : DEFAULT_SETTINGS.fontCacheSize,
    favouriteTemplateIds: stringArray(source.favouriteTemplateIds, []),
    recentTemplateIds: recent,
    defaultNewPageFlow: flows.includes(source.defaultNewPageFlow as DefaultPageFlow)
      ? source.defaultNewPageFlow as DefaultPageFlow
      : DEFAULT_SETTINGS.defaultNewPageFlow,
    libraryDensity: densities.includes(source.libraryDensity as LibraryDensity)
      ? source.libraryDensity as LibraryDensity
      : DEFAULT_SETTINGS.libraryDensity,
    styleRules: normalizeStyleRules(source.styleRules),
    userTemplates,
  };
}
