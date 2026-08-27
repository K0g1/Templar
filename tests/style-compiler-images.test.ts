import { describe, expect, it } from 'vitest';
import { compileImages } from '../src/services/style-compiler/images';
import { fragmentContext } from './style-compiler-fixture';

describe('image compiler fragment', () => {
  it('emits frame, filter, and float declarations for the unified grid engine', () => {
    const css = compileImages(fragmentContext((style) => {
      style.images.float = 'right';
      style.images.duotone = '#a34f2c';
    }));
    expect(css).toContain('float: right');
    expect(css).toContain('grayscale(1) sepia(1)');
    expect(css).not.toContain('var(--templar-image-snap');
  });
});
