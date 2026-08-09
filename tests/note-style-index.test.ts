import { describe, expect, it } from 'vitest';
import { NoteStyleIndex } from '../src/services/note-style-index';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';

describe('usage index', () => {
  it('builds lazily once and updates counts incrementally', () => {
    const index = new NoteStyleIndex();
    let scans = 0;
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    const source = () => { scans += 1; return [{ path: 'A/one.md', folder: 'A', style }]; };
    index.ensureBuilt(source);
    index.ensureBuilt(source);
    expect(scans).toBe(1);
    expect(index.count(style.sourceTemplateId!)).toBe(1);
    expect(index.countInFolder(style.sourceTemplateId!, 'A')).toBe(1);
    expect(index.entriesForTemplate(style.sourceTemplateId!).map((note) => note.path)).toEqual(['A/one.md']);
    index.rename('A/one.md', { path: 'B/one.md', folder: 'B', style });
    expect(index.countInFolder(style.sourceTemplateId!, 'A')).toBe(0);
    expect(index.countInFolder(style.sourceTemplateId!, 'B')).toBe(1);
    expect(index.entriesForTemplate(style.sourceTemplateId!).map((note) => note.path)).toEqual(['B/one.md']);
    index.remove('B/one.md');
    expect(index.count(style.sourceTemplateId!)).toBe(0);
    expect(index.entriesForTemplate(style.sourceTemplateId!)).toEqual([]);
  });
});
