import type { TFile } from 'obsidian';

export function fakeFileManager() {
  return {
    async processFrontMatter(
      _file: TFile,
      callback: (frontmatter: Record<string, unknown>) => void,
    ): Promise<void> {
      callback({});
    },
  };
}
