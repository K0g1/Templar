import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createJiti } from 'jiti';

if (process.argv[2] !== '--write') {
  console.error('Refusing to update fingerprints without the deliberate --write flag.');
  process.exitCode = 1;
} else {
  const jiti = createJiti(process.cwd());
  const { BUILT_IN_TEMPLATES } = jiti('./src/templates/builtins.ts');
  const fingerprints = Object.fromEntries(
    BUILT_IN_TEMPLATES.map((template) => [template.id, sha256(canonicalize(template))]),
  );
  const output = `${JSON.stringify(fingerprints, null, 2)}\n`;
  writeFileSync(resolve('tests/fixtures/builtin-fingerprints.json'), output);
}

function sha256(value) {
  return `sha256-${createHash('sha256').update(value, 'utf8').digest('hex')}`;
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
