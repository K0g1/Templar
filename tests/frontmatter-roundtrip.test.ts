import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import {
  templateToNoteStyle,
  noteStyleToFrontmatter,
  frontmatterToNoteStyle,
  templateToExportObject,
  parsedObjectToTemplate,
} from '../src/templates/note-format';
import { clone } from '../src/utils/value';

describe('frontmatter round-trip characterization', () => {
  it('every built-in template survives style -> frontmatter -> style', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      const style = templateToNoteStyle(template);
      const frontmatter = noteStyleToFrontmatter(style);
      const restored = frontmatterToNoteStyle(frontmatter);
      expect(restored, `${template.id} did not round-trip`).not.toBeNull();
      expect(restored!.page.mode, `${template.id} page mode changed`).toBe(style.page.mode);
      expect(restored!.id, `${template.id} id changed`).toBe(style.id);
      expect(restored!.name, `${template.id} name changed`).toBe(style.name);
      expect(restored!.page.width, `${template.id} width changed`).toBe(style.page.width);
      expect(restored!.page.height, `${template.id} height changed`).toBe(style.page.height);
      expect(restored!.baseline.unit, `${template.id} baseline unit changed`).toBe(
        style.baseline.unit,
      );
      expect(restored!.typography.bodyFont, `${template.id} body font changed`).toBe(
        style.typography.bodyFont,
      );
      expect(
        restored!.headings.h1.size,
        `${template.id} h1 size changed`,
      ).toBe(style.headings.h1.size);
    }
  });

  it('round-trip preserves page mode explicitly', () => {
    for (const mode of ['pageless', 'paged'] as const) {
      for (const size of ['a4', 'letter', 'custom'] as const) {
        const template = BUILT_IN_TEMPLATES[0]!;
        const style = templateToNoteStyle(template);
        style.page.mode = mode;
        style.page.size = size;
        style.page.scaleToFit = true;
        const restored = frontmatterToNoteStyle(noteStyleToFrontmatter(style));
        expect(restored?.page.mode).toBe(mode);
        expect(restored?.page.size).toBe(size);
        expect(restored?.page.scaleToFit).toBe(true);
      }
    }
  });

  it('template export object round-trips through parsedObjectToTemplate', () => {
    for (const template of BUILT_IN_TEMPLATES.slice(0, 20)) {
      const exported = templateToExportObject(template);
      const restored = parsedObjectToTemplate(exported);
      expect(restored.id, `${template.id} export id mismatch`).toBe(template.id);
      expect(restored.name, `${template.id} export name mismatch`).toBe(template.name);
      expect(
        restored.metadata.description,
        `${template.id} export description mismatch`,
      ).toBe(template.metadata.description);
      expect(restored.headings.h1.size, `${template.id} export h1 size mismatch`).toBe(
        template.headings.h1.size,
      );
    }
  });

  it('cloning a style preserves deep equality of page options', () => {
    const template = BUILT_IN_TEMPLATES[2]!;
    const style = templateToNoteStyle(template);
    const copy = clone(style);
    expect(copy).toEqual(style);
    copy.page.width = 777;
    expect(style.page.width).not.toBe(777);
  });
});
