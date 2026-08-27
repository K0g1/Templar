import { describe, expect, it } from 'vitest';
import { compilePageBase } from '../src/services/style-compiler/page';
import { fragmentContext } from './style-compiler-fixture';

describe('page compiler fragment', () => {
  it('emits scoped paper and page geometry', () => {
    const css = compilePageBase(fragmentContext());
    expect(css).toContain('--templar-baseline-position: 81px');
    expect(css).toContain('.templar-page-content::before');
    expect(css).toContain('isolation: isolate;');
    expect(css).toContain('margin-block-end: var(--templar-editor-line-tail, 0px) !important;');
  });
});
