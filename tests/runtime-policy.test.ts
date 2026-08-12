import { describe, expect, it } from 'vitest';
import { runtimePolicyViolations } from '../scripts/verify-runtime-policy.mjs';

describe('runtime policy scanner', () => {
  it.each([
    ['node import', `import fs from 'node:fs'`],
    ['electron import', `import { shell } from 'electron'`],
    ['require', `const x = require('x')`],
    ['Buffer', `Buffer.from('x')`],
    ['process', `process.env.X`],
    ['fetch', `fetch('/x')`],
    ['XMLHttpRequest', `new XMLHttpRequest()`],
    ['WebSocket', `new WebSocket('ws://x')`],
    ['EventSource', `new EventSource('/x')`],
    ['sendBeacon', `navigator.sendBeacon('/x')`],
    ['requestUrl', `requestUrl({ url: 'x' })`],
    ['FileSystemAdapter', `new FileSystemAdapter()`],
  ])('rejects %s runtime fixture', (_label, source) => {
    expect(runtimePolicyViolations(source).length).toBeGreaterThan(0);
  });

  it('rejects positive and negative lookbehind syntax', () => {
    const marker = String.fromCharCode(63, 60);
    const positive = `/(${marker}=foo)bar/`;
    const negative = `/(${marker}!foo)bar/`;
    const violations = runtimePolicyViolations(`${positive}; ${negative};`);

    expect(violations.filter((violation) => violation.label === 'regex lookbehind')).toHaveLength(2);
  });

  it('does not reject lookbehind-like text without regex syntax', () => {
    const marker = String.fromCharCode(63, 60);
    const violations = runtimePolicyViolations(`const text = "${marker}= and ${marker}! are ordinary text";`);

    expect(violations).toEqual([]);
  });

  it('allows comments, strings, ordinary identifiers, and ordinary regexes', () => {
    const source = `// fetch FileSystemAdapter process\nconst processValue = 'fetch'; const regex = /a+b/;`;
    expect(runtimePolicyViolations(source)).toEqual([]);
  });
});
