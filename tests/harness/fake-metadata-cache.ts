import type { TFile } from 'obsidian';

export function fakeMetadataCache() {
  const values = new Map<string, { frontmatter?: Record<string, unknown> }>();
  return {
    values,
    getFileCache(file: TFile) {
      return values.get(file.path) ?? null;
    },
  };
}
