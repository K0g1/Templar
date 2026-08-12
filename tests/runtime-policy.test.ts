import { describe, expect, it } from 'vitest';
import { runtimePolicyViolations } from '../scripts/verify-runtime-policy.mjs';

describe('runtime policy scanner', () => {
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
});
