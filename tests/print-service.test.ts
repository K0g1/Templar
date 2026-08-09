import { describe, expect, it } from 'vitest';
import { printPageSize } from '../src/services/print-layout';
import { BUILT_IN_TEMPLATES } from '../src/templates/builtins';
import { templateToNoteStyle } from '../src/templates/note-format';

describe('print sizing', () => {
  it('requests pageless, A4, Letter, and custom dimensions', () => {
    const style = templateToNoteStyle(BUILT_IN_TEMPLATES[0]!);
    expect(printPageSize(style)).toBe('auto');
    style.page.mode = 'paged';
    expect(printPageSize(style)).toBe('A4');
    style.page.size = 'letter';
    expect(printPageSize(style)).toBe('Letter');
    style.page.size = 'custom';
    style.page.width = 960;
    style.page.height = 1440;
    expect(printPageSize(style)).toBe('10in 15in');
  });
});
