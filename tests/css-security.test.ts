import { describe, expect, it } from 'vitest';
import { validateCustomCss } from '../src/services/css-validator';

function errors(css: string): string[] {
  return validateCustomCss(css).issues
    .filter((issue) => issue.severity === 'error')
    .map((issue) => issue.message);
}

describe('CSS security regression suite', () => {
  describe('URL and resource loading', () => {
    it('blocks literal url() in declarations', () => {
      const result = errors('.page p { background: url(https://evil.com/x.png); }');
      expect(result.some((m) => m.includes('external or embedded URL'))).toBe(true);
    });

    it('blocks escaped url() forms', () => {
      const escaped = errors('.page p { background: u\\72l(https://evil.com/x.png); }');
      expect(escaped.some((m) => m.includes('external or embedded URL'))).toBe(true);

      const hex = errors('.page p { background: \\75rl(https://evil.com/x.png); }');
      expect(hex.some((m) => m.includes('external or embedded URL'))).toBe(true);
    });

    it('blocks data URLs', () => {
      const result = errors('.page p { background: url(data:image/svg+xml;base64,PHN2Zz4=); }');
      expect(result.some((m) => m.includes('external or embedded URL'))).toBe(true);
    });

    it('blocks protocol-relative URLs', () => {
      const result = errors('.page p { background: url(//evil.com/x.png); }');
      expect(result.some((m) => m.includes('external or embedded URL'))).toBe(true);
    });

    it('blocks image-set and src functions', () => {
      const imageSet = errors('.page p { background-image: image-set(url(a.png) 1x); }');
      expect(imageSet.some((m) => m.includes('external or embedded URL'))).toBe(true);
    });

    it('allows plain color and gradient values', () => {
      const plain = validateCustomCss('.page p { color: #123456; background: linear-gradient(red, blue); }');
      expect(plain.valid).toBe(true);
    });
  });

  describe('whole-note hiding protection', () => {
    it('blocks hiding the entire page with a plain selector', () => {
      const result = errors('.page { display: none; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks hiding page-content with visibility', () => {
      const result = errors('.page-content { visibility: hidden; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks hiding via opacity 0', () => {
      const result = errors('.page { opacity: 0; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks hiding via universal child selector', () => {
      const result = errors('.page * { display: none; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks hiding via :is(*) selector', () => {
      const result = errors('.page-content :is(*) { opacity: 0; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks hiding via :where(*) selector', () => {
      const result = errors('.page :where(*) { visibility: hidden; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('blocks pointer-events none on the whole page', () => {
      const result = errors('.page { pointer-events: none; }');
      expect(result.some((m) => m.includes('hide or disable the whole note'))).toBe(true);
    });

    it('allows hiding a specific element only', () => {
      const result = validateCustomCss('.page p.optional { display: none; }');
      expect(result.valid).toBe(true);
    });

    it('allows opacity on a specific element', () => {
      const result = validateCustomCss('.page img.faded { opacity: 0.5; }');
      expect(result.valid).toBe(true);
    });
  });

  describe('CSS complexity budget', () => {
    it('rejects :has() selectors', () => {
      const result = errors('.page:has(> .foo) { color: red; }');
      expect(result.length).toBeGreaterThan(0);
    });

    it('rejects infinite animations', () => {
      const result = errors('.page p { animation: spin 2s infinite; }');
      // Must be an error, not just a warning
      expect(result.some((m) => m.toLowerCase().includes('infinite'))).toBe(true);
    });

    it('rejects excessive rule counts', () => {
      const rules: string[] = [];
      for (let i = 0; i < 260; i += 1) {
        rules.push(`.page .r${String(i)} { color: red; }`);
      }
      const result = validateCustomCss(rules.join('\n'));
      expect(result.valid).toBe(false);
    });
  });

  describe('positioning and overlay safety', () => {
    it('blocks position: fixed', () => {
      const result = errors('.page p { position: fixed; }');
      expect(result.some((m) => m.includes('Fixed positioning'))).toBe(true);
    });

    it('blocks z-index above 20', () => {
      const result = errors('.page p { z-index: 999; }');
      expect(result.some((m) => m.includes('z-index'))).toBe(true);
    });

    it('allows z-index within range', () => {
      const result = validateCustomCss('.page p { z-index: 10; }');
      expect(result.valid).toBe(true);
    });
  });

  describe('global scope protection', () => {
    it('rejects selectors not scoped to .page', () => {
      const result = errors('body { color: red; }');
      expect(result.some((m) => m.includes('not scoped'))).toBe(true);
    });

    it('rejects :global() escape', () => {
      const result = errors('.page :global(body) { color: red; }');
      expect(result.some((m) => m.includes(':global()'))).toBe(true);
    });

    it('rejects Templar private class names', () => {
      const result = errors('.page .templar-page { color: red; }');
      expect(result.some((m) => m.includes('private'))).toBe(true);
    });
  });
});
