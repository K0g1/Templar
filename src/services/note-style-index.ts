import type { TemplarNoteStyle } from '../types';
import { clone } from '../utils/value';

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
    const nextNotes = new Map<string, IndexedNote>();
    const nextUsage = new Map<string, number>();
    const nextTemplatePaths = new Map<string, Set<string>>();
    const nextFolderUsage = new Map<string, Map<string, number>>();
    for (const rawNote of source()) {
      const note = cloneIndexedNote(rawNote);
      const previous = nextNotes.get(note.path);
      if (previous) {
        adjustMaps(previous, -1, nextUsage, nextTemplatePaths, nextFolderUsage);
      }
      nextNotes.set(note.path, note);
      adjustMaps(note, 1, nextUsage, nextTemplatePaths, nextFolderUsage);
    }
    this.replaceMaps(nextNotes, nextUsage, nextTemplatePaths, nextFolderUsage);
    this.built = true;
  }

  public update(note: IndexedNote): void {
    const next = cloneIndexedNote(note);
    const previous = this.notes.get(next.path);
    if (previous) this.adjust(previous, -1);
    this.notes.set(next.path, next);
    this.adjust(next, 1);
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
      return note ? [cloneIndexedNote(note)] : [];
    });
  }

  public allEntries(): IndexedNote[] {
    return [...this.notes.values()].map(cloneIndexedNote);
  }

  private replaceMaps(
    notes: Map<string, IndexedNote>,
    usage: Map<string, number>,
    templatePaths: Map<string, Set<string>>,
    folderUsage: Map<string, Map<string, number>>,
  ): void {
    this.notes.clear();
    this.usage.clear();
    this.templatePaths.clear();
    this.folderUsage.clear();
    for (const [path, note] of notes) this.notes.set(path, note);
    for (const [id, count] of usage) this.usage.set(id, count);
    for (const [id, paths] of templatePaths) this.templatePaths.set(id, new Set(paths));
    for (const [folder, counts] of folderUsage) this.folderUsage.set(folder, new Map(counts));
  }

  private adjust(note: IndexedNote, delta: 1 | -1): void {
    adjustMaps(note, delta, this.usage, this.templatePaths, this.folderUsage);
  }

}

function cloneIndexedNote(note: IndexedNote): IndexedNote {
  return {
    path: note.path,
    folder: note.folder,
    style: note.style ? clone(note.style) : null,
  };
}

function adjustMaps(
  note: IndexedNote,
  delta: 1 | -1,
  usage: Map<string, number>,
  templatePaths: Map<string, Set<string>>,
  folderUsage: Map<string, Map<string, number>>,
): void {
  const id = note.style?.sourceTemplateId;
  if (!id) return;
  setCount(usage, id, delta);
  let paths = templatePaths.get(id);
  if (delta === 1) {
    if (!paths) {
      paths = new Set();
      templatePaths.set(id, paths);
    }
    paths.add(note.path);
  } else if (paths) {
    paths.delete(note.path);
    if (paths.size === 0) templatePaths.delete(id);
  }
  let folder = folderUsage.get(note.folder);
  if (!folder) {
    folder = new Map();
    folderUsage.set(note.folder, folder);
  }
  setCount(folder, id, delta);
  if (folder.size === 0) folderUsage.delete(note.folder);
}

function setCount(map: Map<string, number>, key: string, delta: 1 | -1): void {
  const next = (map.get(key) ?? 0) + delta;
  if (next <= 0) map.delete(key);
  else map.set(key, next);
}
