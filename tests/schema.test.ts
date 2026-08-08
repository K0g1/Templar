import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import {
  frontmatterToNoteStyle,
  noteStyleToFrontmatter,
  templateToExportObject,
  templateToNoteStyle,
} from '../src/templates/note-format';
import {
  normalizeTemplate,
  validateTemplate,
  validateTemplateSource,
} from '../src/templates/schema';
import { validateCustomCss } from '../src/services/css-validator';
import { record } from '../src/utils/value';

describe('Templar v1 schema', () => {
  it('normalizes human-readable kebab-case template keys', () => {
    const template = normalizeTemplate({
      version: 1,
      'style-name': 'Cozy Field Notes',
      'template-id': 'cozy-field-notes',
      baseline: { unit: 28, 'snap-images': false },
      typography: { 'body-font': 'Georgia, serif', 'body-size': 16 },
      layout: { 'max-width': 760, 'padding-left': 88 },
      blocks: {
        'highlight-background': 'rgba(200, 150, 20, 0.4)',
        'highlight-text-color': '#241f16',
        'code-font': 'Consolas, monospace',
        'code-size': 15,
      },
    });
    expect(template.name).toBe('Cozy Field Notes');
    expect(template.id).toBe('cozy-field-notes');
    expect(template.baseline.unit).toBe(28);
    expect(template.baseline.snapImages).toBe(false);
    expect(template.typography.bodySize).toBe(16);
    expect(template.layout.paddingLeft).toBe(88);
    expect(template.blocks.highlightBackground).toBe('rgba(200, 150, 20, 0.4)');
    expect(template.blocks.highlightTextColor).toBe('#241f16');
    expect(template.blocks.codeFont).toBe('Consolas, monospace');
    expect(template.blocks.codeSize).toBe(15);
  });

  it('round-trips a self-contained note style', () => {
    const original = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    original.page.mode = 'paged';
    original.page.size = 'letter';
    original.page.width = 816;
    original.page.height = 1056;
    original.attachments = {
      'mountains.jpg': { frame: 'polaroid', rotation: -2, width: 420 },
    };
    const yamlObject = noteStyleToFrontmatter(original);
    const restored = frontmatterToNoteStyle(yamlObject);
    expect(restored?.name).toBe(original.name);
    expect(restored?.paper.pattern).toBe('ruled');
    expect(restored?.attachments?.['mountains.jpg']?.width).toBe(420);
    expect(restored?.blocks.highlightBackground).toBe(
      original.blocks.highlightBackground,
    );
    expect(restored?.blocks.highlightTextColor).toBe(
      original.blocks.highlightTextColor,
    );
    expect(restored?.headings.h4).toEqual(original.headings.h4);
    expect(restored?.blocks.codeFont).toBe(original.blocks.codeFont);
    expect(restored?.blocks.codeSize).toBe(original.blocks.codeSize);
    expect(restored?.blocks.tableHeaderBackground).toBe(
      original.blocks.tableHeaderBackground,
    );
    expect(restored?.page).toMatchObject({
      mode: 'paged',
      size: 'letter',
      width: 816,
      height: 1056,
    });
    expect(yamlObject).toHaveProperty('style-name', original.name);
  });

  it('ships only valid built-in styles and scoped custom CSS', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(28);
    for (const template of BUILT_IN_TEMPLATES) {
      expect(validateTemplate(template).valid, template.name).toBe(true);
      expect(validateCustomCss(template.css).valid, template.name).toBe(true);
    }
  });

  it('defaults the highlight pair for older v1 styles that omit it', () => {
    const exported = templateToExportObject(BUILT_IN_TEMPLATES[0]!);
    const source = record(exported['templar-template']);
    const legacyBlocks = record(source.blocks);
    delete legacyBlocks['highlight-background'];
    delete legacyBlocks['highlight-text-color'];

    expect(
      validateTemplateSource(exported).some((issue) => issue.path.includes('highlight')),
    ).toBe(false);
    const normalized = normalizeTemplate(source);
    expect(normalized.blocks.highlightBackground).toBeTruthy();
    expect(normalized.blocks.highlightTextColor).toBeTruthy();
  });

  it('keeps page mode out of reusable template exports', () => {
    const exported = templateToExportObject(BUILT_IN_TEMPLATES[0]!);
    expect(exported).toHaveProperty('templar-template');
    expect(exported['templar-template']).not.toHaveProperty('page');
  });

  it('rejects template padding that cannot fit every supported page size', () => {
    const template = normalizeTemplate(BUILT_IN_TEMPLATES[0]!);
    template.layout.paddingLeft = 200;
    template.layout.paddingRight = 200;
    template.layout.paddingTop = 260;
    template.layout.paddingBottom = 260;
    const result = validateTemplate(template);
    expect(result.valid).toBe(false);
    expect(result.issues.filter((issue) => issue.path === 'layout')).toHaveLength(2);
  });
});
