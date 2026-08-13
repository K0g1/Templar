import { describe, expect, it } from 'vitest';
import { inspectRawNoteStyle } from '../src/services/style-inspection';
import { inspectNoteStyleSchema, inspectTemplateSchema } from '../src/templates/schema';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { noteStyleToFrontmatter, templateToNoteStyle } from '../src/templates/note-format';

describe('protected schema inspection', () => {
  it('distinguishes absent data from current renderable data', () => {
    const absent = inspectRawNoteStyle(undefined);
    expect(absent.status).toBe('absent');
    expect(absent.rawExists).toBe(false);
    expect(absent.automaticOverwriteAllowed).toBe(true);

    const raw = noteStyleToFrontmatter(templateToNoteStyle(BUILT_IN_TEMPLATES[0]!));
    const current = inspectRawNoteStyle(raw);
    expect(current.status).toBe('current');
    expect(current.rawExists).toBe(true);
    expect(current.style?.id).toBe(BUILT_IN_TEMPLATES[0]!.id);
    expect(current.automaticOverwriteAllowed).toBe(false);
  });

  it('protects future and invalid note data', () => {
    const future = inspectRawNoteStyle({ version: 2, id: 'future' });
    expect(future.status).toBe('unsupported-future');
    expect(future.rawExists).toBe(true);
    expect(future.style).toBeNull();
    expect(future.automaticOverwriteAllowed).toBe(false);

    const invalid = inspectRawNoteStyle({ version: 1, attachments: [] });
    expect(invalid.status).toBe('invalid');
    expect(invalid.automaticOverwriteAllowed).toBe(false);
  });

  it('omits an unreadable nested source snapshot without blocking the outer note', () => {
    const raw = noteStyleToFrontmatter(templateToNoteStyle(BUILT_IN_TEMPLATES[0]!));
    const provenance = raw.provenance as Record<string, unknown>;
    provenance['source-snapshot'] = { version: 2, id: 'newer-source' };
    const result = inspectNoteStyleSchema(raw);
    expect(result.status).toBe('current');
    expect(result.value).not.toBeNull();
    expect(result.value?.provenance?.sourceSnapshot).toBeUndefined();
    expect(result.issues.some((issue) => issue.message.includes('provenance.source-snapshot'))).toBe(true);
  });

  it('fingerprints equivalent objects independently of key insertion order', () => {
    const first = inspectRawNoteStyle({ version: 2, b: 2, a: 1 });
    const second = inspectRawNoteStyle({ a: 1, version: 2, b: 2 });
    expect(first.fingerprint).toBe(second.fingerprint);
    expect(inspectTemplateSchema({ version: 2 }).status).toBe('unsupported-future');
  });

  it('keeps a renderable outer style while marking a future source snapshot as protected', () => {
    const raw = noteStyleToFrontmatter(templateToNoteStyle(BUILT_IN_TEMPLATES[0]!));
    raw.provenance = { 'source-snapshot': { version: 2, future: 'preserve-me' } };
    const inspection = inspectRawNoteStyle(raw);
    expect(inspection.status).toBe('current');
    expect(inspection.style?.id).toBe(BUILT_IN_TEMPLATES[0]!.id);
    expect(inspection.protectedPaths).toEqual([expect.objectContaining({
      path: 'provenance.source-snapshot',
      status: 'unsupported-future',
      rawVersion: 2,
    })]);
  });
});
