import { describe, expect, it } from 'vitest';
import { compileAttachments } from '../src/services/style-compiler/attachments';
import { fragmentContext } from './style-compiler-fixture';

describe('attachment compiler fragment', () => {
  it('emits encoded, per-attachment overrides', () => {
    const css = compileAttachments(fragmentContext((style) => {
      style.attachments = { 'family photo.png': { frame: 'polaroid', rotation: 2, width: 240 } };
    }));
    expect(css).toContain('src*="family%20photo.png"');
    expect(css).toContain('border-bottom-width: 32px');
    expect(css).toContain('rotate(2deg)');
  });
});
