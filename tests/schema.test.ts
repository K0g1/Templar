import { describe, expect, it } from 'vitest';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import {
  frontmatterToNoteStyle,
  noteStyleToFrontmatter,
  templateToExportObject,
  templateToNoteStyle,
} from '../src/templates/note-format';
import {
  normalizeNoteStyle,
  normalizePageOptions,
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
    expect(restored?.provenance?.sourceSnapshot?.id).toBe(original.sourceTemplateId);
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

  it('round-trips source history and automatic rule attribution', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.provenance!.appliedByRule = { id: 'journal-notes', name: 'Journal notes' };
    const restored = frontmatterToNoteStyle(noteStyleToFrontmatter(style));
    expect(restored?.provenance?.appliedByRule).toEqual({ id: 'journal-notes', name: 'Journal notes' });
    expect(restored?.provenance?.sourceSnapshot?.paper).toEqual(style.paper);
  });

  it('ships only valid built-in styles and scoped custom CSS', () => {
    expect(BUILT_IN_TEMPLATES).toHaveLength(132);
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

  it('normalizes the extended paper, typography, and list fields', () => {
    const template = normalizeTemplate({
      version: 1,
      'style-name': 'Expanded',
      'template-id': 'expanded',
      paper: {
        pattern: 'hex',
        'pattern-opacity': 0.5,
        'pattern-scale': 2,
        'dot-radius': 3,
        'graph-major-interval': 7,
      },
      typography: {
        'body-line-height': 34,
        'first-line-indent': 24,
        'drop-cap': true,
      },
      lists: {
        'marker-style': 'square',
        'marker-color': '#441122',
        'indent-guides': true,
        'indent-guide-color': 'rgba(1, 2, 3, 0.2)',
        'nested-indent': 40,
      },
    });
    expect(template.paper.pattern).toBe('hex');
    expect(template.paper.patternOpacity).toBe(0.5);
    expect(template.paper.patternScale).toBe(2);
    expect(template.paper.dotRadius).toBe(3);
    expect(template.paper.graphMajorInterval).toBe(7);
    expect(template.typography.bodyLineHeight).toBe(34);
    expect(template.typography.firstLineIndent).toBe(24);
    expect(template.typography.dropCap).toBe(true);
    expect(template.lists.markerStyle).toBe('square');
    expect(template.lists.markerColor).toBe('#441122');
    expect(template.lists.indentGuides).toBe(true);
    expect(template.lists.nestedIndent).toBe(40);
  });

  it('falls back gracefully for unknown patterns and zero line height', () => {
    const template = normalizeTemplate({
      'style-name': 'Fallbacks',
      'template-id': 'fallbacks',
      paper: { pattern: 'plaid' },
      typography: { 'body-line-height': 0 },
    });
    expect(template.paper.pattern).toBe('blank');
    expect(template.typography.bodyLineHeight).toBe(0);
    expect(template.typography.bodyLineHeight === 0).toBe(true);
  });

  it('round-trips extended image, block, and watermark fields', () => {
    const original = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    original.images.float = 'left';
    original.images.objectFit = 'cover';
    original.images.duotone = '#a34f2c';
    original.blocks.dividerStyle = 'dashed';
    original.blocks.dividerWidth = 4;
    original.blocks.tableStriped = true;
    original.blocks.calloutVariants = {
      warning: { accent: '#c77b3a', background: 'rgba(199, 123, 58, 0.12)' },
      tip: { titleColor: '#2f6b3a' },
    };
    original.watermark = {
      text: 'Draft',
      color: 'rgba(48, 46, 43, 0.1)',
      size: 120,
      rotation: -30,
      opacity: 0.5,
    };
    const yamlObject = noteStyleToFrontmatter(original);
    const restored = frontmatterToNoteStyle(yamlObject);
    expect(restored?.images).toMatchObject({
      float: 'left',
      objectFit: 'cover',
      duotone: '#a34f2c',
    });
    expect(restored?.blocks.dividerStyle).toBe('dashed');
    expect(restored?.blocks.dividerWidth).toBe(4);
    expect(restored?.blocks.tableStriped).toBe(true);
    expect(restored?.blocks.calloutVariants).toEqual({
      warning: { accent: '#c77b3a', background: 'rgba(199, 123, 58, 0.12)' },
      tip: { titleColor: '#2f6b3a' },
    });
    expect(restored?.watermark).toEqual(original.watermark);
  });

  it('rejects invalid callout variant keys and unsupported enum values', () => {
    const badVariants = normalizeTemplate({
      'style-name': 'Bad variants',
      'template-id': 'bad-variants',
      blocks: {
        'callout-variants': {
          'note': { accent: '#112233' },
          'BAD TYPE!': { accent: '#445566' },
        },
      },
    });
    expect(badVariants.blocks.calloutVariants).toEqual({ note: { accent: '#112233' } });
    const badDuotone = normalizeTemplate({
      'style-name': 'Bad duotone',
      'template-id': 'bad-duotone',
      images: { duotone: 'greenish' },
    });
    expect(badDuotone.images.duotone).toBe('greenish');
    const badObjectFit = normalizeTemplate({
      'style-name': 'Bad fit',
      'template-id': 'bad-fit',
      images: { 'object-fit': 'stretch' },
    });
    expect(badObjectFit.images.objectFit).toBe('contain');
  });

  it('validates extended color fields and the duotone hex requirement', () => {
    const template = normalizeTemplate(BUILT_IN_TEMPLATES[0]!);
    template.blocks.calloutAccent = 'red;';
    template.blocks.dividerColor = 'url(x)';
    template.images.duotone = 'greenish';
    template.watermark.text = 'bad "quotes" here';
    const issues = validateTemplate(template).issues;
    expect(issues.some((issue) => issue.path === 'blocks.calloutAccent')).toBe(true);
    expect(issues.some((issue) => issue.path === 'blocks.dividerColor')).toBe(true);
    expect(issues.some((issue) => issue.path === 'images.duotone')).toBe(true);
    expect(issues.some((issue) => issue.path === 'watermark.text')).toBe(true);
  });

  it('derives h5 and h6 heading styles for every built-in', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.headings.h5.font, template.name).toBeTruthy();
      expect(template.headings.h6.font, template.name).toBeTruthy();
      expect(template.headings.h5.size).toBeGreaterThan(template.headings.h6.size);
    }
  });

  it('fails closed for malformed or unsupported live note styles', () => {
    expect(normalizeNoteStyle({})).toBeNull();
    expect(normalizeNoteStyle({ version: 2 })).toBeNull();
    expect(() => normalizeTemplate({ version: 2 })).toThrow(/unsupported/i);
  });

  it('canonicalizes named page presets and retains custom geometry', () => {
    expect(normalizePageOptions({ size: 'a4', width: 1800, height: 2400 })).toMatchObject({
      size: 'a4',
      width: 794,
      height: 1123,
    });
    expect(normalizePageOptions({ size: 'letter', width: 480, height: 640 })).toMatchObject({
      size: 'letter',
      width: 816,
      height: 1056,
    });
    expect(normalizePageOptions({ size: 'custom', width: 900, height: 1400 })).toMatchObject({
      width: 900,
      height: 1400,
    });
  });

  it('normalizes callout type keys to Obsidian data-callout casing', () => {
    const template = normalizeTemplate({
      version: 1,
      blocks: { 'callout-variants': { INFO: { accent: '#123456' } } },
    });
    expect(template.blocks.calloutVariants).toEqual({ info: { accent: '#123456' } });
  });

  it('enforces the hard collection and structured-value limits', () => {
    const template = normalizeTemplate(BUILT_IN_TEMPLATES[0]!);
    template.blocks.calloutVariants = Object.fromEntries(
      Array.from({ length: 65 }, (_, index) => [`type-${String(index)}`, { accent: '#123456' }]),
    );
    expect(validateTemplate(template).valid).toBe(false);

    template.blocks.calloutVariants = Object.fromEntries(
      Array.from({ length: 64 }, (_, index) => [`type-${String(index)}`, { accent: '#123456' }]),
    );
    expect(validateTemplate(template).valid).toBe(true);

    template.paper.color = 'var(--background-primary)';
    expect(validateTemplate(template).valid).toBe(false);
    template.paper.color = '#fff';
    template.layout.pageShadow = 'env(safe-area-inset-top)';
    expect(validateTemplate(template).valid).toBe(false);
  });

  it('fails closed for oversized attachment collections and filenames', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.attachments = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [`image-${String(index)}.png`, { width: 100 }]),
    );
    expect(frontmatterToNoteStyle(noteStyleToFrontmatter(style))).not.toBeNull();

    style.attachments = Object.fromEntries(
      Array.from({ length: 513 }, (_, index) => [`image-${String(index)}.png`, { width: 100 }]),
    );
    expect(frontmatterToNoteStyle(noteStyleToFrontmatter(style))).toBeNull();

    style.attachments = { ['a'.repeat(513) + '.png']: { width: 100 } };
    expect(frontmatterToNoteStyle(noteStyleToFrontmatter(style))).toBeNull();

    style.attachments = Object.fromEntries(
      Array.from({ length: 512 }, (_, index) => [`noop-${String(index)}.png`, {}]),
    );
    const noOp = frontmatterToNoteStyle(noteStyleToFrontmatter(style));
    expect(noOp).not.toBeNull();
    expect(noOp?.attachments).toBeUndefined();
  });
});
