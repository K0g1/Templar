import type { TemplarNoteStyle, TemplarTemplate } from '../types';
import { clone } from '../utils/value';

export type SynchronizationState =
  | 'up-to-date'
  | 'modified'
  | 'update-available'
  | 'modified-update-available'
  | 'source-missing'
  | 'legacy-update-unknown';

export interface SynchronizationStatus {
  state: SynchronizationState;
  modified: boolean;
  updateAvailable: boolean;
  legacy: boolean;
}

function snapshot(template: TemplarTemplate): TemplarTemplate {
  const result = clone(template);
  delete result.builtIn;
  return result;
}

function equal(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function templateSnapshot(template: TemplarTemplate): TemplarTemplate {
  return snapshot(template);
}

export function noteTemplateSnapshot(style: TemplarNoteStyle): TemplarTemplate {
  const result = clone(style) as TemplarTemplate & {
    page?: unknown;
    attachments?: unknown;
    provenance?: unknown;
    sourceTemplateId?: unknown;
  };
  delete result.builtIn;
  delete result.page;
  delete result.attachments;
  delete result.provenance;
  delete result.sourceTemplateId;
  return result;
}

export function synchronizationStatus(
  style: TemplarNoteStyle,
  currentSource: TemplarTemplate | null,
): SynchronizationStatus {
  const base = style.provenance?.sourceSnapshot;
  if (!currentSource) {
    return {
      state: 'source-missing',
      modified: base ? !equal(noteTemplateSnapshot(style), snapshot(base)) : false,
      updateAvailable: false,
      legacy: !base,
    };
  }
  const current = noteTemplateSnapshot(style);
  const latest = snapshot(currentSource);
  if (!base) {
    if (equal(current, latest)) {
      return { state: 'up-to-date', modified: false, updateAvailable: false, legacy: true };
    }
    return {
      state: 'legacy-update-unknown',
      modified: false,
      updateAvailable: true,
      legacy: true,
    };
  }
  const normalizedBase = snapshot(base);
  const modified = !equal(current, normalizedBase);
  const updateAvailable = !equal(normalizedBase, latest);
  const state = modified && updateAvailable
    ? 'modified-update-available'
    : modified
      ? 'modified'
      : updateAvailable
        ? 'update-available'
        : 'up-to-date';
  return { state, modified, updateAvailable, legacy: false };
}

const missing = Symbol('missing');

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeValue(
  base: unknown,
  current: unknown,
  latest: unknown,
): unknown {
  if (equal(current === missing ? undefined : current, base === missing ? undefined : base)) {
    return latest;
  }
  if (isRecord(base) && isRecord(current) && isRecord(latest)) {
    const result: Record<string, unknown> = {};
    const keys = new Set([...Object.keys(base), ...Object.keys(current), ...Object.keys(latest)]);
    for (const key of keys) {
      const value = mergeValue(
        Object.prototype.hasOwnProperty.call(base, key) ? base[key] : missing,
        Object.prototype.hasOwnProperty.call(current, key) ? current[key] : missing,
        Object.prototype.hasOwnProperty.call(latest, key) ? latest[key] : missing,
      );
      if (value !== missing) {
        result[key] = value;
      }
    }
    return result;
  }
  return current;
}

export function mergeTemplateUpdate(
  style: TemplarNoteStyle,
  latestSource: TemplarTemplate,
): TemplarNoteStyle {
  const base = style.provenance?.sourceSnapshot;
  if (!base) {
    throw new Error('This older note does not contain a safe merge baseline.');
  }
  const merged = mergeValue(
    snapshot(base),
    noteTemplateSnapshot(style),
    snapshot(latestSource),
  );
  if (!isRecord(merged)) {
    throw new Error('The template update could not be merged.');
  }
  const result = {
    ...(clone(merged) as unknown as TemplarTemplate),
    page: clone(style.page),
    sourceTemplateId: latestSource.id,
    provenance: {
      sourceSnapshot: snapshot(latestSource),
      ...(style.provenance?.appliedByRule
        ? { appliedByRule: clone(style.provenance.appliedByRule) }
        : {}),
    },
    ...(style.attachments ? { attachments: clone(style.attachments) } : {}),
  } as TemplarNoteStyle;
  delete result.builtIn;
  return result;
}

export function replaceWithLatestTemplate(
  style: TemplarNoteStyle,
  latestSource: TemplarTemplate,
): TemplarNoteStyle {
  const latest = snapshot(latestSource) as TemplarNoteStyle;
  latest.page = clone(style.page);
  latest.sourceTemplateId = latestSource.id;
  latest.provenance = {
    sourceSnapshot: snapshot(latestSource),
    ...(style.provenance?.appliedByRule
      ? { appliedByRule: clone(style.provenance.appliedByRule) }
      : {}),
  };
  if (style.attachments) {
    latest.attachments = clone(style.attachments);
  }
  return latest;
}
