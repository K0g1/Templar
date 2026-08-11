import { describe, expect, it } from 'vitest';
import { leafScopeValue } from '../src/utils/scope';

describe('leaf renderer scopes', () => {
  it('never aliases two leaves even when they show the same path', () => {
    const scopes = Array.from({ length: 10_000 }, (_, index) => leafScopeValue(index + 1));
    expect(new Set(scopes).size).toBe(scopes.length);
    expect(leafScopeValue(1)).not.toBe(leafScopeValue(2));
  });
});
