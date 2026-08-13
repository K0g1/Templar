import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import {
  inspectTemplatePackSchema,
  parseTemplatePack,
  templatePackToExportObject,
  uniqueCopyId,
} from '../src/services/template-pack';

describe('template packs', () => {
  it('protects a future pack wrapper before normal member parsing', () => {
    const result = inspectTemplatePackSchema({ 'templar-pack': { version: 2, templates: [] } });
    expect(result.status).toBe('unsupported-future');
    expect(result.value).toBeNull();
  });

  it('reports a future member without default-normalizing it', () => {
    const exported = templatePackToExportObject(
      { name: 'Future member', description: '', author: '', tags: [] },
      BUILT_IN_TEMPLATES.slice(0, 1),
    );
    const pack = exported['templar-pack'] as Record<string, unknown>;
    const member = (pack.templates as Record<string, unknown>[])[0]!;
    member.version = 2;
    const result = inspectTemplatePackSchema(exported);
    expect(result.status).toBe('current');
    expect(result.value?.templates).toHaveLength(0);
    expect(result.issues.some((issue) => issue.message.includes('templates[0]'))).toBe(true);
  });

  it('keeps valid pack members visible when another member is protected', () => {
    const exported = templatePackToExportObject(
      { name: 'Mixed future', description: '', author: '', tags: [] },
      BUILT_IN_TEMPLATES.slice(0, 2),
    );
    const pack = exported['templar-pack'] as Record<string, unknown>;
    const members = pack.templates as Record<string, unknown>[];
    members[1]!.version = 2;
    const review = parseTemplatePack(exported);
    expect(review?.templates[0]?.valid).toBe(true);
    expect(review?.templates[1]?.valid).toBe(false);
  });

  it('round-trips multiple independently validated templates', () => {
    const exported = templatePackToExportObject(
      { name: 'Writing', description: 'Two styles', author: 'Tester', tags: ['writing'] },
      BUILT_IN_TEMPLATES.slice(0, 2),
    );
    const review = parseTemplatePack(exported);
    expect(review?.pack.name).toBe('Writing');
    expect(review?.templates).toHaveLength(2);
    expect(review?.templates.every((entry) => entry.valid)).toBe(true);
  });

  it('does not let one invalid member hide valid members', () => {
    const exported = templatePackToExportObject(
      { name: 'Mixed', description: '', author: '', tags: [] },
      BUILT_IN_TEMPLATES.slice(0, 2),
    );
    const pack = (exported['templar-pack'] as Record<string, unknown>);
    const templates = pack.templates as Record<string, unknown>[];
    templates[1]!.css = 'body { display: none; }';
    const review = parseTemplatePack(exported)!;
    expect(review.templates[0]?.valid).toBe(true);
    expect(review.templates[1]?.valid).toBe(false);
  });

  it('creates deterministic conflict copy IDs', () => {
    expect(uniqueCopyId('paper', new Set(['paper-copy']))).toBe('paper-copy-2');
  });

  it('surfaces duplicate IDs inside the incoming pack', () => {
    const exported = templatePackToExportObject(
      { name: 'Duplicates', description: '', author: '', tags: [] },
      [BUILT_IN_TEMPLATES[0]!, BUILT_IN_TEMPLATES[0]!],
    );
    const review = parseTemplatePack(exported)!;
    expect(review.templates.every((entry) => !entry.valid)).toBe(true);
    expect(review.templates[0]?.issues.some((issue) => issue.message.includes('duplicate'))).toBe(true);
  });

  it('bounds pack member count before member normalization', () => {
    const exported = templatePackToExportObject(
      { name: 'Bounded', description: '', author: '', tags: [] },
      [BUILT_IN_TEMPLATES[0]!],
    );
    const pack = exported['templar-pack'] as Record<string, unknown>;
    const member = (pack.templates as unknown[])[0];
    pack.templates = Array.from({ length: 257 }, () => member);
    expect(() => parseTemplatePack(exported)).toThrow(/at most 256/i);
  });
});
