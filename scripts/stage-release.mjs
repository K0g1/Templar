import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tag = process.argv[2];
const outputDirectory = resolve(process.argv[3] ?? '.release');
const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));

if (!tag || !isSemver(tag)) {
  throw new Error('Pass a SemVer release tag without a v prefix.');
}

const releaseNotesPath = resolve(repositoryRoot, 'docs', 'releases', `${tag}.md`);
if (!existsSync(releaseNotesPath)) {
  throw new Error(`Missing release notes: ${releaseNotesPath}`);
}

const publicAssets = ['main.js', 'manifest.json', 'styles.css'];
for (const name of publicAssets) {
  const source = resolve(repositoryRoot, name);
  if (!existsSync(source)) throw new Error(`Missing release artifact: ${name}`);
}

rmSync(outputDirectory, { recursive: true, force: true });
mkdirSync(outputDirectory, { recursive: true });

for (const name of publicAssets) {
  cpSync(resolve(repositoryRoot, name), resolve(outputDirectory, name));
}

const checksums = publicAssets.map((name) => {
  const hash = createHash('sha256')
    .update(requireFile(resolve(outputDirectory, name)))
    .digest('hex');
  return `${hash}  ${name}`;
});
writeText('SHA256SUMS.txt', `${checksums.join('\n')}\n`);
writeText('release-notes.md', requireFile(releaseNotesPath));
writeText(
  'release-metadata.json',
  `${JSON.stringify({
    tag,
    title: `Templar ${tag}`,
    prerelease: tag.includes('-'),
    assets: [...publicAssets, 'SHA256SUMS.txt'],
  }, null, 2)}\n`,
);

const expectedFiles = new Set([
  ...publicAssets,
  'SHA256SUMS.txt',
  'release-notes.md',
  'release-metadata.json',
]);
const actualFiles = new Set(readdirSync(outputDirectory));
if (actualFiles.size !== expectedFiles.size || [...expectedFiles].some((name) => !actualFiles.has(name))) {
  throw new Error(`Release staging produced an unexpected file set: ${[...actualFiles].sort().join(', ')}`);
}

console.log(`Staged ${tag} release bundle in ${outputDirectory}.`);

function writeText(name, value) {
  writeFileSync(resolve(outputDirectory, name), value);
}

function requireFile(path) {
  if (!existsSync(path)) throw new Error(`Missing file: ${path}`);
  return readFile(path);
}

function readFile(path) {
  return readFileSync(path);
}

function isSemver(value) {
  return /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(value);
}
