import { TFolder, type App } from 'obsidian';

export async function ensureVaultFolderTree(app: App, folder: string): Promise<void> {
  const segments = folder.replace(/\\/g, '/').split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = app.vault.getAbstractFileByPath(current);
    if (existing && !isFolder(existing)) {
      throw new Error(`“${current}” is a file, not a folder.`);
    }
    if (!existing) await app.vault.createFolder(current);
  }
}

function isFolder(value: unknown): boolean {
  if (typeof TFolder === 'function') return value instanceof TFolder;
  return typeof value === 'object' && value !== null && 'children' in value;
}
