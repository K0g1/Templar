import { describe, expect, it } from 'vitest';
import { patternDeclarations, safeValue } from '../src/services/style-compiler/paper';
import { fragmentContext } from './style-compiler-fixture';

describe('paper compiler fragment', () => {
  it('serializes grid patterns from shared baseline coordinates', () => {
    const context = fragmentContext((style) => { style.paper.pattern = 'graph'; });
    const css = patternDeclarations(context.style, 'var(--templar-paper-baseline-position)', context.paddingLeft);
    expect(css).toContain('background-position: 0 0, min(96px, 18%) var(--templar-paper-baseline-position)');
    expect(safeValue('red; } body { display: none', '#fff')).toBe('#fff');
  });
});
