import type { DefaultPageFlow, StyleRule } from '../types';

export interface RuleNoteFacts {
  path: string;
  basename: string;
  folder: string;
  tags: string[];
  frontmatter: Record<string, unknown>;
  metadataReady: boolean;
}

function folded(value: string): string {
  return value.trim().toLocaleLowerCase();
}

function scalar(value: unknown): string | null {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return folded(String(value));
  }
  return null;
}

export function ruleMatches(rule: StyleRule, note: RuleNoteFacts): boolean {
  if (!rule.enabled || rule.conditions.length === 0) {
    return false;
  }
  return rule.conditions.every((condition) => {
    if (condition.type === 'folder') {
      const wanted = folded(condition.folder).replace(/^\/+|\/+$/g, '');
      const actual = folded(note.folder).replace(/^\/+|\/+$/g, '');
      return condition.includeSubfolders
        ? actual === wanted || actual.startsWith(`${wanted}/`)
        : actual === wanted;
    }
    if (condition.type === 'tag') {
      if (!note.metadataReady) return false;
      const wanted = folded(condition.tag).replace(/^#/, '');
      return note.tags.some((tag) => folded(tag).replace(/^#/, '') === wanted);
    }
    if (condition.type === 'filename') {
      const actual = folded(note.basename);
      const wanted = folded(condition.value);
      if (condition.operator === 'starts-with') return actual.startsWith(wanted);
      if (condition.operator === 'ends-with') return actual.endsWith(wanted);
      if (condition.operator === 'contains') return actual.includes(wanted);
      return actual === wanted;
    }
    if (!note.metadataReady) return false;
    const value = scalar(note.frontmatter[condition.property]);
    return value !== null && value === folded(condition.value);
  });
}

export function firstMatchingRule(
  rules: readonly StyleRule[],
  note: RuleNoteFacts,
): StyleRule | null {
  for (const rule of rules) {
    if (!rule.enabled || rule.conditions.length === 0) continue;
    if (!note.metadataReady && rule.conditions.some((condition) => condition.type === 'tag' || condition.type === 'frontmatter')) {
      const staticConditions = rule.conditions.filter((condition) => condition.type === 'folder' || condition.type === 'filename');
      const staticallyPossible = staticConditions.length === 0 || ruleMatches(
        { ...rule, conditions: staticConditions },
        note,
      );
      if (staticallyPossible) return null;
      continue;
    }
    if (ruleMatches(rule, note)) return rule;
  }
  return null;
}

export function pageFlowOptions(flow: DefaultPageFlow): {
  mode: 'pageless' | 'paged';
  size: 'a4' | 'letter';
  width: number;
  height: number;
} {
  if (flow === 'paged-letter') {
    return { mode: 'paged', size: 'letter', width: 816, height: 1056 };
  }
  if (flow === 'paged-a4') {
    return { mode: 'paged', size: 'a4', width: 794, height: 1123 };
  }
  return { mode: 'pageless', size: 'a4', width: 794, height: 1123 };
}
