import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const script = resolve(process.cwd(), 'scripts/verify-brat-release.mjs');

function fixture(version = '1.3.0-alpha.1'): string {
  const directory = mkdtempSync(join(tmpdir(), 'templar-brat-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'templar', version }));
  writeFileSync(join(directory, 'manifest.json'), JSON.stringify({
    id: 'templar',
    name: 'Templar',
    version,
    minAppVersion: '1.8.0',
    description: 'test',
    author: 'test',
    isDesktopOnly: false,
  }));
  writeFileSync(join(directory, 'main.js'), 'x'.repeat(10_001));
  writeFileSync(join(directory, 'styles.css'), '.templar {}');
  return directory;
}

function verify(version: string, directory: string): void {
  execFileSync(process.execPath, [script, version, directory], { stdio: 'pipe' });
}

function failure(directory: string, expected: string, version = '1.3.0-alpha.1'): void {
  try {
    verify(version, directory);
    throw new Error('verifier unexpectedly passed');
  } catch (error) {
    expect(String(error)).toContain(expected);
  }
}

describe('BRAT release contract verifier', () => {
  it.each(['1.3.0', '1.3.0-alpha.1', '1.3.0-beta.2', '1.3.0-rc.1', '1.3.0-alpha.10'])('accepts %s', (version) => {
      const directory = fixture(version);
      try {
        expect(() => verify(version, directory)).not.toThrow();
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    });

  it('rejects missing and malformed artifact files', () => {
    const missingManifest = fixture();
    unlinkSync(join(missingManifest, 'manifest.json'));
    failure(missingManifest, 'missing manifest.json');
    rmSync(missingManifest, { recursive: true, force: true });

    const malformedManifest = fixture();
    writeFileSync(join(malformedManifest, 'manifest.json'), '{');
    failure(malformedManifest, 'manifest.json is not valid JSON');
    rmSync(malformedManifest, { recursive: true, force: true });

    const arrayManifest = fixture();
    writeFileSync(join(arrayManifest, 'manifest.json'), '[]');
    failure(arrayManifest, 'manifest.json must contain a JSON object');
    rmSync(arrayManifest, { recursive: true, force: true });

    const missingBundle = fixture();
    unlinkSync(join(missingBundle, 'main.js'));
    failure(missingBundle, 'missing main.js');
    rmSync(missingBundle, { recursive: true, force: true });

    const emptyBundle = fixture();
    writeFileSync(join(emptyBundle, 'main.js'), '');
    failure(emptyBundle, 'main.js does not satisfy');
    rmSync(emptyBundle, { recursive: true, force: true });

    const missingStyles = fixture();
    unlinkSync(join(missingStyles, 'styles.css'));
    failure(missingStyles, 'missing styles.css');
    rmSync(missingStyles, { recursive: true, force: true });
  });

  it('rejects manifest identity, version, type, and casing violations', () => {
    const wrongId = fixture();
    const manifest = JSON.parse(readFileSync(join(wrongId, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    manifest.id = 'other';
    writeFileSync(join(wrongId, 'manifest.json'), JSON.stringify(manifest));
    failure(wrongId, 'id must be templar');
    rmSync(wrongId, { recursive: true, force: true });

    const missingVersion = fixture();
    const missing = JSON.parse(readFileSync(join(missingVersion, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    delete missing.version;
    writeFileSync(join(missingVersion, 'manifest.json'), JSON.stringify(missing));
    failure(missingVersion, 'is missing version');
    rmSync(missingVersion, { recursive: true, force: true });

    const mismatched = fixture('1.3.0-alpha.1');
    failure(mismatched, 'manifest.json version', '1.3.0-alpha.2');
    rmSync(mismatched, { recursive: true, force: true });

    const prefixed = fixture('1.3.0-alpha.1');
    failure(prefixed, 'valid SemVer', 'v1.3.0-alpha.1');
    rmSync(prefixed, { recursive: true, force: true });

    const wrongCase = fixture();
    unlinkSync(join(wrongCase, 'main.js'));
    writeFileSync(join(wrongCase, 'Main.js'), 'x'.repeat(10_001));
    failure(wrongCase, 'wrong casing');
    rmSync(wrongCase, { recursive: true, force: true });

    const stringDesktop = fixture();
    const stringManifest = JSON.parse(readFileSync(join(stringDesktop, 'manifest.json'), 'utf8')) as Record<string, unknown>;
    stringManifest.isDesktopOnly = 'false';
    writeFileSync(join(stringDesktop, 'manifest.json'), JSON.stringify(stringManifest));
    failure(stringDesktop, 'isDesktopOnly must be boolean');
    rmSync(stringDesktop, { recursive: true, force: true });
  });
});
