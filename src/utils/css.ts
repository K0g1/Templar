/**
 * CSS helpers shared between the validator and the compiler.
 *
 * These functions must stay dependency-free (no PostCSS imports) so both
 * pipelines use the exact same normalization without a hidden ordering
 * dependency between them.
 */

/**
 * Decodes CSS escape sequences (hex and single-character) so security checks
 * and name comparisons see the canonical form. Without this, `u\72l(...)`
 * bypasses a literal `url(` check and escaped at-rule names are classified
 * differently by validator and compiler.
 */
export function decodeCssEscapes(value: string): string {
  return value.replace(
    /\\(?:([0-9a-f]{1,6})\s?|([^\r\n0-9a-f]))/gi,
    (_match, hex: string | undefined, character: string | undefined) => {
      if (hex) {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint === 0 || codePoint > 0x10ffff
          ? '\uFFFD'
          : String.fromCodePoint(codePoint);
      }
      return character ?? '';
    },
  );
}

/** Canonical, escape-decoded, lowercased at-rule name. */
export function normalizeAtRuleName(name: string): string {
  return decodeCssEscapes(name).toLowerCase();
}

/** True when the at-rule is a (possibly prefixed) keyframes block. */
export function isKeyframesAtRuleName(name: string): boolean {
  return /keyframes$/i.test(normalizeAtRuleName(name));
}
