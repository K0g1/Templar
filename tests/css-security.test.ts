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

describe('CSS semantic bypass regression suite', () => {
  it('rejects var() indirection for position', () => {
    const result = errors('.page p { --p: fixed; position: var(--p); }');
    expect(result.some((m) => m.includes('variable'))).toBe(true);
  });

  it('rejects var() indirection for display', () => {
    const result = errors('.page { --d: none; display: var(--d); }');
    expect(result.length).toBeGreaterThan(0);
  });

  it('rejects calc(0) opacity on whole-note selector', () => {
    const result = errors('.page { opacity: calc(0); }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects huge finite animation iteration counts', () => {
    const result = errors('.page p { animation: spin 0.1s 1000000000; }');
    expect(result.some((m) => m.toLowerCase().includes('iteration'))).toBe(true);
  });

  it('rejects long durations in later comma-separated animations', () => {
    const result = errors('.page p { animation: a 0.1s, b 3600s; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects animation var() indirection', () => {
    const result = errors('.page p { --n: infinite; animation-iteration-count: var(--n); }');
    expect(result.some((m) => m.includes('variable'))).toBe(true);
  });

  it('rejects @layer statement ordering', () => {
    const result = errors('@layer theme, base, templar;');
    expect(result.some((m) => m.includes('not allowed'))).toBe(true);
  });

  it('rejects transform scale(0) on whole-note selector', () => {
    const result = errors('.page * { transform: scale(0); }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects filter opacity(0) on whole-note selector', () => {
    const result = errors('.page-content :is(*) { filter: opacity(0); }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects escaping keyframes name in at-rule allowlist handling', () => {
    const escaped = errors('.page p { animation: spin 1s; } @\\6b eyframes spin { to { opacity: 1; } }');
    expect(escaped.length).toBeGreaterThan(0);
  });

  it('rejects deeply nested functional selectors', () => {
    const nested = '.page :is(.a .b .c .d .e .f .g .h .i .j) { color: red; }';
    const result = errors(nested);
    expect(result.some((m) => m.includes('nesting depth'))).toBe(true);
  });

  it('rejects scaleX(0) and scale(calc(0)) whole-note hiding', () => {
    const a = errors('.page * { transform: scaleX(0); }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page * { scale: 0; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects filter opacity variants on whole-note selectors', () => {
    const a = errors('.page * { filter: opacity(0%); }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page * { filter: opacity(0.0); }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects clip-path circle(0) on whole-note selectors', () => {
    const result = errors('.page * { clip-path: circle(0); }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects animation runtime via longhand combination', () => {
    const result = errors('.page p { animation-duration: 30s; animation-iteration-count: 1000; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects animation shorthand with duration before iteration count', () => {
    const result = errors('.page p { animation: spin 30s 1000 linear; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });
});

describe('CSS round 3 bypass regression suite', () => {
  it('rejects translate offscreen on whole-note selectors', () => {
    const result = errors('.page * { translate: -100000px 0; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects whole-note hiding via *:nth-child(n)', () => {
    const result = errors('.page *:nth-child(n) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects animation with matching duration and iteration values', () => {
    const result = errors('.page p { animation: spin 6s 6 linear; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects animation with commas inside function parameters', () => {
    const result = errors('.page p { animation: spin 10s cubic-bezier(.1,.2,.3,.4) 4; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects longhand list pairing duration x iteration', () => {
    const result = errors('.page p { animation-duration: 10s, 1s; animation-iteration-count: 4, 1; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });
});

describe('CSS round 4 bypass regression suite', () => {
  it('rejects nth-child(1n) and nth-child(n+1) whole-note hiding', () => {
    const a = errors('.page *:nth-child(1n) { display: none; }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page *:nth-child(n+1) { opacity: 0; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects shorthand iteration combined with longhand duration', () => {
    const result = errors('.page p { animation: spin .1s 100; animation-duration: 1s; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects mismatched list lengths with repetition semantics', () => {
    const result = errors('.page p { animation-duration: 10s, 1s; animation-iteration-count: 4; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });
});

describe('CSS round 5 bypass regression suite', () => {
  it('rejects structural pseudo hiding via child combinator', () => {
    const a = errors('.page > *:nth-child(n) { display: none; }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page-content > :nth-child(n) { opacity: 0; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects calc() in animation iteration count', () => {
    const result = errors('.page p { animation-duration: 1s; animation-iteration-count: calc(31); }');
    expect(result.some((m) => m.toLowerCase().includes('math functions'))).toBe(true);
  });

  it('rejects calc() in animation duration', () => {
    const result = errors('.page p { animation-duration: calc(1s * 31); }');
    expect(result.some((m) => m.toLowerCase().includes('math functions'))).toBe(true);
  });

  it('short-circuits oversized CSS with an error', () => {
    const huge = `.page p { color: red; }\n`.repeat(20000);
    const result = validateCustomCss(huge);
    expect(result.valid).toBe(false);
    expect(result.issues.some((i) => i.message.includes('50 KB'))).toBe(true);
  });

  it('handles large animation lists in O(n+m) without hangs', () => {
    // Keep the combined declarations just under the 50 KB cap: 2000
    // durations + 2000 iterations is enough to expose an O(lcm) blowup if
    // one existed (lcm(2000, 2000) = 2000; use coprime lengths to force a
    // large lcm: 1001 and 1000 -> lcm ~1,001,000 iterations).
    const durations = Array.from({ length: 1000 }, (_, i) => `${String((i % 30) + 1)}s`).join(', ');
    const iterations = Array.from({ length: 1001 }, () => '1').join(', ');
    const css = `.page p { animation-duration: ${durations}; animation-iteration-count: ${iterations}; }`;
    expect(css.length).toBeLessThan(50_000);
    const start = Date.now();
    const result = validateCustomCss(css);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(result.valid).toBe(true); // durations up to 30s x 1 iteration
  });
});

describe('CSS round 6 bypass regression suite', () => {
  it('rejects direct-root pseudo selectors', () => {
    const a = errors('.page:is(*) { opacity: 0; }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page:nth-child(n) { visibility: hidden; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
    const c = errors('.page-content:where(*) { pointer-events: none; }');
    expect(c.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects :is() with mixed universal and non-universal branches', () => {
    const result = errors('.page :is(*, p) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects nested forgiving pseudos', () => {
    const result = errors('.page :is(:where(*)) { visibility: hidden; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects math functions in animation iteration count', () => {
    const result = errors('.page p { animation-duration: 1s; animation-iteration-count: max(31, 31); }');
    expect(result.some((m) => m.toLowerCase().includes('math functions'))).toBe(true);
  });

  it('rejects scientific notation durations over the runtime cap', () => {
    const result = errors('.page p { animation-duration: 4e1s; animation-iteration-count: 1; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('allows non-hiding descendant selectors on the root', () => {
    // .page p applies to descendants, not the root: not whole-note hiding.
    const result = errors('.page p { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(false);
  });
});

describe('CSS round 7 bypass regression suite', () => {
  it('rejects complex :is() branches with combinators', () => {
    const a = errors('.page :is(* > *) { display: none; }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page :where(* > *) { opacity: 0; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('allows narrow :is() branches with element compounds', () => {
    const result = errors('.page :is(p > span) { color: red; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(false);
  });

  it('rejects leading-decimal scientific notation iteration counts', () => {
    const result = errors('.page p { animation: spin 1s .4e2; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects signed iteration counts', () => {
    const result = errors('.page p { animation: spin 1s +40; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects leading-decimal durations', () => {
    const result = errors('.page p { animation-duration: .4e2s; animation-iteration-count: 1; }');
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });
});

describe('CSS round 8 bypass regression suite', () => {
  it('rejects !important duration override of a safe later normal value', () => {
    const result = errors([
      '.page p {',
      '  animation-duration: 30s !important;',
      '  animation-duration: 0s;',
      '  animation-iteration-count: 1000;',
      '}',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects !important iteration count override of a safe later normal value', () => {
    const result = errors([
      '.page p {',
      '  animation-iteration-count: 1000 !important;',
      '  animation-iteration-count: 1;',
      '  animation-duration: 30s;',
      '}',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects !important shorthand duration with normal longhand', () => {
    const result = errors([
      '.page p {',
      '  animation: spin 30s !important;',
      '  animation-duration: 0s;',
      '  animation-iteration-count: 1000;',
      '}',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });
});

describe('CSS round 9 bypass regression suite', () => {
  it('rejects cross-rule animation duration + iteration combination', () => {
    const result = errors([
      '.page p { animation-duration: 30s; }',
      '.page p { animation-iteration-count: 1000; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects cross-rule combination with overlapping selectors', () => {
    const result = errors([
      '.page p { animation-duration: 30s; }',
      '.page .foo { animation-iteration-count: 1000; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('handles huge animation lists in linear time', () => {
    const durations = Array.from({ length: 3000 }, (_, i) => `${String((i % 30) + 1)}s`).join(', ');
    const iterations = Array.from({ length: 3001 }, () => '1').join(', ');
    const css = `.page p { animation-duration: ${durations}; animation-iteration-count: ${iterations}; }`;
    expect(css.length).toBeLessThan(50_000);
    const start = Date.now();
    const result = validateCustomCss(css);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(result.valid).toBe(true);
  });
});

describe('CSS round 10 bypass regression suite', () => {
  it('rejects shorthand iteration count before animation name', () => {
    const result = errors([
      '@keyframes spin { from { opacity: .9; } to { opacity: 1; } }',
      '.page p { animation: .1s 100 spin; }',
      '.page p { animation-duration: 1s; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects :not(:not(*)) universal descendant hiding', () => {
    const result = errors('.page :not(:not(*)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects :not(:not(:where(*))) nested double negation', () => {
    const result = errors('.page :not(:not(:where(*))) { visibility: hidden; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });
});

describe('CSS round 11 bypass regression suite', () => {
  it('rejects :not() with selector list double negation', () => {
    const result = errors('.page :not(:not(*), :not(*)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects :not() with complex universal branch', () => {
    const result = errors('.page :not(:not(* > *)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects comment-hidden iteration counts', () => {
    const result = errors([
      '@keyframes spin { from { opacity: .9; } to { opacity: 1; } }',
      '.page p { animation: 1s 1000000000/**/spin; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('rejects comment-hidden count before timing function', () => {
    const result = errors([
      '@keyframes spin { from { opacity: .9; } to { opacity: 1; } }',
      '.page p { animation: 1s 1000000000/**/linear; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('runtime'))).toBe(true);
  });

  it('still allows :not(*) which matches nothing', () => {
    const result = errors('.page :not(*) { color: red; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(false);
  });
});

describe('CSS round 12 bypass regression suite', () => {
  it('rejects contradictory compound negation :not(.x:not(.x))', () => {
    const result = errors('.page :not(.x:not(.x)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects contradictory universal negation :not(*:not(*))', () => {
    const result = errors('.page :not(*:not(*)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects contradictory compound inside :is()', () => {
    const result = errors('.page :not(:is(*:not(*))) { visibility: hidden; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });
});

describe('CSS round 13 bypass regression suite', () => {
  it('rejects :not(.x:not(*)) contradictory compound', () => {
    const result = errors('.page :not(.x:not(*)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects :not(.x:is(:not(*))) nested empty pseudo', () => {
    const result = errors('.page :not(.x:is(:not(*))) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects :not(:not(*) > *) complex branch with empty compound', () => {
    const result = errors('.page :not(:not(*) > *) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });
});

describe('CSS round 14 bypass regression suite', () => {
  it('rejects complementary :is() branches covering everything', () => {
    const result = errors('.page :is(.x, :not(.x)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects sibling pseudo negation contradiction', () => {
    const result = errors('.page :not(:not(.x):not(:not(.x))) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects visibility collapse on whole-note selector', () => {
    const result = errors('.page * { visibility: collapse; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects negative opacity (clamped to 0) on whole-note selector', () => {
    const result = errors('.page * { opacity: -1; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });
});

describe('CSS round 15 bypass regression suite', () => {
  it('rejects forwards fill-mode animation on whole-note selector', () => {
    const result = errors([
      '@keyframes fade { from { opacity: 1; } to { opacity: 0; } }',
      '.page { animation: fade .1s forwards; }',
    ].join('\n'));
    expect(result.some((m) => m.toLowerCase().includes('forwards/both'))).toBe(true);
  });

  it('rejects multi-branch tautology :is(.x, .y, :not(.x, .y))', () => {
    const result = errors('.page :is(.x, .y, :not(.x, .y)) { display: none; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('rejects opacity via math function on whole-note selector', () => {
    const result = errors('.page * { opacity: min(-1, 0); }');
    expect(result.some((m) => m.includes('hide or disable') || m.includes('math'))).toBe(true);
  });

  it('rejects font-size zero variants', () => {
    const a = errors('.page * { font-size: 0.0px; }');
    expect(a.some((m) => m.includes('hide or disable'))).toBe(true);
    const b = errors('.page * { font-size: +0px; }');
    expect(b.some((m) => m.includes('hide or disable'))).toBe(true);
    const c = errors('.page * { font-size: 0e0px; }');
    expect(c.some((m) => m.includes('hide or disable'))).toBe(true);
  });

  it('does not flag .foo:not(.foobar) as contradictory', () => {
    const result = errors('.page :not(.foo:not(.foobar)) { color: red; }');
    expect(result.some((m) => m.includes('hide or disable'))).toBe(false);
  });
});
