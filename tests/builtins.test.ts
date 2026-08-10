import { describe, expect, it } from 'vitest';
import { validateCustomCss } from '../src/services/css-validator';
import { contrastRatio } from '../src/templates/accessibility';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { validateTemplate } from '../src/templates/schema';

describe('built-in template catalog', () => {
  it('ships at least 124 uniquely named templates', () => {
    expect(BUILT_IN_TEMPLATES.length).toBeGreaterThanOrEqual(124);
    expect(new Set(BUILT_IN_TEMPLATES.map((template) => template.id)).size).toBe(
      BUILT_IN_TEMPLATES.length,
    );
    expect(new Set(BUILT_IN_TEMPLATES.map((template) => template.name)).size).toBe(
      BUILT_IN_TEMPLATES.length,
    );
  });

  it('organizes the catalog into a diverse set of useful folders', () => {
    const folders = new Set(BUILT_IN_TEMPLATES.map((template) => template.metadata.folder));
    expect(folders.size).toBeGreaterThanOrEqual(12);
    expect([...folders]).toEqual(expect.arrayContaining([
      'Essentials',
      'Seasons',
      'Academia',
      'Professional',
      'Journaling & Wellness',
      'Travel',
      'Nature',
      'Vintage & Editorial',
      'Dark & Neon',
      'Fantasy & Whimsy',
      'Pastels',
    ]));
    for (const template of BUILT_IN_TEMPLATES) {
      expect(template.metadata.folder.trim(), template.name).not.toBe('');
      expect(template.metadata.tags.length, template.name).toBeGreaterThanOrEqual(2);
    }
  });

  it('keeps every template schema-valid with portable scoped CSS', () => {
    for (const template of BUILT_IN_TEMPLATES) {
      expect(validateTemplate(template).valid, template.name).toBe(true);
      expect(validateCustomCss(template.css).valid, template.name).toBe(true);
    }
  });

  it('maintains readable ordinary text, links, and highlights', () => {
    const failures: string[] = [];
    for (const template of BUILT_IN_TEMPLATES) {
      const checks: Array<readonly [string, number, number]> = [
        ['body text', contrastRatio(template.typography.textColor, template.paper.color), 4.5],
        ['muted text', contrastRatio(template.typography.mutedColor, template.paper.color), 4.5],
        ['embedded text', contrastRatio(
          template.typography.textColor,
          template.blocks.embedBackground,
          template.paper.color,
        ), 4.5],
        ['embed accent', contrastRatio(
          template.blocks.embedAccent,
          template.blocks.embedBackground,
          template.paper.color,
        ), 4.5],
        ['links', contrastRatio(template.blocks.linkColor, template.paper.color), 4.5],
        ['highlighted text', contrastRatio(
          template.blocks.highlightTextColor,
          template.blocks.highlightBackground,
          template.paper.color,
        ), 4.5],
        ['quote text', contrastRatio(
          template.blocks.quoteTextColor,
          template.blocks.quoteBackground,
          template.paper.color,
        ), 4.5],
        ['code text', contrastRatio(
          template.blocks.codeTextColor,
          template.blocks.codeBackground,
          template.paper.color,
        ), 4.5],
        ['callout text', contrastRatio(
          template.blocks.calloutTextColor,
          template.blocks.calloutBackground,
          template.paper.color,
        ), 4.5],
        ['callout title', contrastRatio(
          template.blocks.calloutTitleColor,
          template.blocks.calloutBackground,
          template.paper.color,
        ), 4.5],
        ['table text', contrastRatio(template.blocks.tableTextColor, template.paper.color), 4.5],
        ['striped table text', contrastRatio(
          template.blocks.tableTextColor,
          template.blocks.tableStripeColor,
          template.paper.color,
        ), 4.5],
        ['table header text', contrastRatio(
          template.blocks.tableHeaderTextColor,
          template.blocks.tableHeaderBackground,
          template.paper.color,
        ), 4.5],
        ['list markers', contrastRatio(template.lists.markerColor, template.paper.color), 3],
        ['indent guides', contrastRatio(template.lists.indentGuideColor, template.paper.color), 3],
        ['checkboxes', contrastRatio(template.blocks.checkboxAccent, template.paper.color), 3],
      ];
      for (const level of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
        const heading = template.headings[level];
        const isLargeText = heading.weight >= 700 ? heading.size >= 18.66 : heading.size >= 24;
        checks.push([
          `${level} heading`,
          contrastRatio(heading.color, template.paper.color),
          isLargeText ? 3 : 4.5,
        ]);
      }
      for (const [type, variant] of Object.entries(template.blocks.calloutVariants)) {
        const background = variant.background ?? template.blocks.calloutBackground;
        checks.push(
          [`${type} callout text`, contrastRatio(
            variant.textColor ?? template.blocks.calloutTextColor,
            background,
            template.paper.color,
          ), 4.5],
          [`${type} callout title`, contrastRatio(
            variant.titleColor ?? template.blocks.calloutTitleColor,
            background,
            template.paper.color,
          ), 4.5],
          [`${type} callout accent`, contrastRatio(
            variant.accent ?? template.blocks.calloutAccent,
            background,
            template.paper.color,
          ), 3],
        );
      }
      for (const [label, ratio, required] of checks) {
        if (ratio < required) {
          failures.push(`${template.name}: ${label} (${ratio.toFixed(2)}:1)`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('built-in template validation under hardened rules', () => {
  it('every built-in template still passes the hardened validator', async () => {
    const { validateCustomCss } = await import('../src/services/css-validator');
    const failures: string[] = [];
    for (const template of BUILT_IN_TEMPLATES) {
      if (!template.css) continue;
      const result = validateCustomCss(template.css);
      if (!result.valid) {
        failures.push(
          `${template.id}: ${result.issues
            .filter((issue) => issue.severity === 'error')
            .map((issue) => issue.message)
            .join('; ')}`,
        );
      }
    }
    expect(failures).toEqual([]);
  });
});
