import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';
import {
  mergeTemplateUpdate,
  replaceWithLatestTemplate,
  synchronizationStatus,
} from '../src/services/synchronization';
import { clone } from '../src/utils/value';

describe('template synchronization', () => {
  it('distinguishes modified and updated states', () => {
    const source = clone(BUILT_IN_TEMPLATES[0]!);
    const note = templateToNoteStyle(source);
    expect(synchronizationStatus(note, source).state).toBe('up-to-date');
    note.paper.color = '#abcdef';
    expect(synchronizationStatus(note, source).state).toBe('modified');
    source.typography.bodySize += 1;
    expect(synchronizationStatus(note, source).state).toBe('modified-update-available');
    delete note.provenance;
    expect(synchronizationStatus(note, source).state).toBe('legacy-update-unknown');
    expect(synchronizationStatus(note, null).state).toBe('source-missing');
  });

  it('merges source changes while preserving local fields and note options', () => {
    const source = clone(BUILT_IN_TEMPLATES[0]!);
    const note = templateToNoteStyle(source);
    note.paper.color = '#abcdef';
    note.page.mode = 'paged';
    note.attachments = { 'photo.png': { width: 420 } };
    const latest = clone(source);
    latest.paper.color = '#111111';
    latest.typography.bodySize = 22;
    latest.blocks.calloutVariants = { warning: { accent: '#ff0000' } };
    const mergedResult = mergeTemplateUpdate(note, latest);
    expect(mergedResult.ok).toBe(true);
    if (!mergedResult.ok) return;
    const merged = mergedResult.style;
    expect(merged.paper.color).toBe('#abcdef');
    expect(merged.typography.bodySize).toBe(22);
    expect(merged.blocks.calloutVariants.warning?.accent).toBe('#ff0000');
    expect(merged.page.mode).toBe('paged');
    expect(merged.attachments?.['photo.png']?.width).toBe(420);
    expect(synchronizationStatus(merged, latest).state).toBe('modified');
  });

  it('replaces design while retaining note-specific data', () => {
    const note = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    note.page.size = 'letter';
    note.attachments = { 'photo.png': { rotation: -2 } };
    const replacement = replaceWithLatestTemplate(note, BUILT_IN_TEMPLATES[1]!);
    expect(replacement.id).toBe(BUILT_IN_TEMPLATES[1]!.id);
    expect(replacement.page.size).toBe('letter');
    expect(replacement.attachments?.['photo.png']?.rotation).toBe(-2);
  });

  it('ignores object key insertion order when comparing snapshots', () => {
    const source = clone(BUILT_IN_TEMPLATES[0]!);
    source.blocks.calloutVariants = {
      info: { accent: '#112233' },
      warning: { accent: '#aabbcc' },
    };
    const note = templateToNoteStyle(source);
    note.blocks.calloutVariants = {
      warning: { accent: '#aabbcc' },
      info: { accent: '#112233' },
    };
    expect(synchronizationStatus(note, source).state).toBe('up-to-date');
  });

  it('rejects a cross-field invalid merge after complete candidate validation', () => {
    const source = clone(BUILT_IN_TEMPLATES[0]!);
    const note = templateToNoteStyle(source);
    note.layout.paddingLeft = 150;
    const latest = clone(source);
    latest.layout.paddingRight = 100;

    const mergedResult = mergeTemplateUpdate(note, latest);
    expect(mergedResult.ok).toBe(false);
    if (mergedResult.ok) return;
    expect(mergedResult.issues.some((issue) => issue.path === 'layout')).toBe(true);
  });
});
