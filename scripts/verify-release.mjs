import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const tag = process.argv[2];
if (!tag || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(tag)) {
  throw new Error('Pass a SemVer release tag without a v prefix.');
}

const readJson = (path) => JSON.parse(readFileSync(resolve(path), 'utf8'));
const packageJson = readJson('package.json');
const manifest = readJson('manifest.json');
const versions = readJson('versions.json');
const expected = packageJson.version;

if (tag !== expected) {
  throw new Error(`Release tag ${tag} does not match package version ${expected}.`);
}
if (manifest.version !== expected) {
  throw new Error(`manifest.json version ${manifest.version} does not match ${expected}.`);
}
if (versions[expected] !== manifest.minAppVersion) {
  throw new Error(
    `versions.json must map ${expected} to minAppVersion ${manifest.minAppVersion}.`,
  );
}

const notesPath = resolve('docs', 'releases', `${tag}.md`);
if (!existsSync(notesPath)) {
  throw new Error(`Missing release notes: ${notesPath}`);
}

console.log(`Release metadata verified for ${tag}.`);
