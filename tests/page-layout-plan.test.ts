import { describe, expect, it } from 'vitest';
import { planPagination } from '../src/services/page-layout-plan';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';

describe('pagination plan', () => {
  it('reads a geometry snapshot once and applies cumulative page shifts mathematically', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.mode = 'paged';
    style.page.width = 100;
    style.page.height = 100;
    style.page.gap = 10;
    style.layout.paddingTop = 10;
    style.layout.paddingBottom = 10;
    style.baseline.enabled = false;
    const first = {} as HTMLElement;
    const second = {} as HTMLElement;
    const plan = planPagination([
      { element: first, naturalTop: 85, height: 30, marginEnd: 0, marginTop: '2px' },
      { element: second, naturalTop: 110, height: 10, marginEnd: 0, marginTop: '3px' },
    ], style, { geometryScale: 1 });

    expect(plan.breaks).toHaveLength(1);
    expect(plan.breaks[0]?.element).toBe(first);
    expect(plan.breaks[0]?.originalMarginTop).toBe('2px');
    expect(plan.breaks[0]?.breakOffset).toBe(35);
    expect(plan.canvasHeight).toBe(210);
  });

  it('keeps print geometry at scale one with no page gap override', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    style.page.height = 100;
    style.page.gap = 50;
    style.layout.paddingTop = 10;
    style.layout.paddingBottom = 10;
    style.baseline.enabled = true;
    style.baseline.mode = 'balanced';
    style.baseline.unit = 10;
    const plan = planPagination([
      { element: {} as HTMLElement, naturalTop: 95, height: 10, marginEnd: 0, marginTop: '0px' },
    ], style, { geometryScale: 1, pageGapOverride: 0 });
    expect(plan.breaks).toHaveLength(1);
    expect(plan.breaks[0]?.breakOffset).toBe(15);
  });
});
