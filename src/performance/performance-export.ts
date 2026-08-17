import { normalizePath, type App, type TFile } from 'obsidian';
import type { PerformanceCapture } from './performance-types';

const EXPORT_FOLDER = 'Templar Performance';

function safeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100) || 'scenario';
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export async function exportPerformanceCapture(
  app: App,
  capture: PerformanceCapture,
): Promise<string> {
  const existing = app.vault.getAbstractFileByPath(EXPORT_FOLDER);
  if (!existing) await app.vault.createFolder(EXPORT_FOLDER);
  let path = normalizePath(
    `${EXPORT_FOLDER}/${safeSegment(capture.scenarioId)}__${timestamp()}.templar-perf.json`,
  );
  let suffix = 1;
  while (app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(
      `${EXPORT_FOLDER}/${safeSegment(capture.scenarioId)}__${timestamp()}-${String(suffix++)}.templar-perf.json`,
    );
  }
  await app.vault.create(path, JSON.stringify(capture, null, 2));
  return path;
}

export function isPerformanceCaptureFile(file: unknown): file is TFile {
  return file instanceof Object &&
    typeof (file as { path?: unknown }).path === 'string' &&
    (file as { path: string }).path.startsWith(`${EXPORT_FOLDER}/`) &&
    (file as { path: string }).path.endsWith('.templar-perf.json');
}
