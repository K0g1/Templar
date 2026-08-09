import type { TemplarNoteStyle } from '../types';

export interface IndexedNote {
  path: string;
  folder: string;
  style: TemplarNoteStyle | null;
}

export class NoteStyleIndex {
  private built = false;
  private readonly notes = new Map<string, IndexedNote>();
  private readonly usage = new Map<string, number>();
  private readonly templatePaths = new Map<string, Set<string>>();
  private readonly folderUsage = new Map<string, Map<string, number>>();

  public isBuilt(): boolean {
    return this.built;
  }

  public ensureBuilt(source: () => Iterable<IndexedNote>): void {
    if (this.built) return;
    this.built = true;
    for (const note of source()) this.update(note);
  }

  public update(note: IndexedNote): void {
    const previous = this.notes.get(note.path);
    if (previous) this.adjust(previous, -1);
    this.notes.set(note.path, note);
    this.adjust(note, 1);
  }

  public remove(path: string): void {
    const previous = this.notes.get(path);
    if (!previous) return;
    this.adjust(previous, -1);
    this.notes.delete(path);
  }

  public rename(oldPath: string, note: IndexedNote): void {
    this.remove(oldPath);
    this.update(note);
  }

  public count(templateId: string): number {
    return this.usage.get(templateId) ?? 0;
  }

  public countInFolder(templateId: string, folder: string): number {
    return this.folderUsage.get(folder)?.get(templateId) ?? 0;
  }

  public entriesForTemplate(templateId: string): IndexedNote[] {
    return [...(this.templatePaths.get(templateId) ?? [])].flatMap((path) => {
      const note = this.notes.get(path);
      return note ? [note] : [];
    });
  }

  public allEntries(): IndexedNote[] {
    return [...this.notes.values()];
  }

  private adjust(note: IndexedNote, delta: 1 | -1): void {
    const id = note.style?.sourceTemplateId;
    if (!id) return;
    this.setCount(this.usage, id, delta);
    let paths = this.templatePaths.get(id);
    if (delta === 1) {
      if (!paths) {
        paths = new Set();
        this.templatePaths.set(id, paths);
      }
      paths.add(note.path);
    } else if (paths) {
      paths.delete(note.path);
      if (paths.size === 0) this.templatePaths.delete(id);
    }
    let folder = this.folderUsage.get(note.folder);
    if (!folder) {
      folder = new Map();
      this.folderUsage.set(note.folder, folder);
    }
    this.setCount(folder, id, delta);
    if (folder.size === 0) this.folderUsage.delete(note.folder);
  }

  private setCount(map: Map<string, number>, key: string, delta: 1 | -1): void {
    const next = (map.get(key) ?? 0) + delta;
    if (next <= 0) map.delete(key);
    else map.set(key, next);
  }
}
