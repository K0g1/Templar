import { createHash } from 'node:crypto';
import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requestedVersion = process.argv[2];
const artifactRoot = resolve(process.argv[3] ?? repositoryRoot);
const publicAssets = ['main.js', 'manifest.json', 'styles.css', 'SHA256SUMS.txt'];
const transportFiles = ['release-notes.md', 'release-metadata.json'];
const strictBundle = artifactRoot !== repositoryRoot;

function fail(message) {
  throw new Error(`BRAT release contract: ${message}`);
}

function readJson(name) {
  const path = resolve(artifactRoot, name);
  if (!existsSync(path)) fail(`missing ${name}`);
  let value;
  try {
    value = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`${name} is not valid JSON (${error instanceof Error ? error.message : String(error)})`);
  }
  return value;
}

function requireFile(name, predicate) {
  const path = resolve(artifactRoot, name);
  if (!existsSync(path)) fail(`missing ${name}`);
  if (!statSync(path).isFile()) fail(`${name} is not a regular file`);
  if (!predicate(path)) fail(`${name} does not satisfy the artifact size contract`);
}

const artifactNames = new Set(readdirSync(artifactRoot));
for (const name of artifactNames) {
  const lower = name.toLowerCase();
  if (['main.js', 'manifest.json', 'styles.css'].includes(lower) && name !== lower) {
    fail(`wrong casing: use ${lower}, not ${name}`);
  }
}
if (artifactNames.has('style.css')) fail('wrong filename: use styles.css, not style.css');
if (strictBundle) {
  const expectedNames = new Set([...publicAssets, ...transportFiles]);
  for (const name of artifactNames) {
    if (!expectedNames.has(name)) fail(`unexpected release asset: ${name}`);
  }
  for (const name of expectedNames) {
    if (!artifactNames.has(name)) fail(`missing ${name}`);
  }
}

const packageJson = existsSync(resolve(artifactRoot, 'package.json'))
  ? readJson('package.json')
  : null;
const expectedVersion = requestedVersion ?? packageJson?.version;
if (typeof expectedVersion !== 'string' || expectedVersion.startsWith('v') || !semver.valid(expectedVersion)) {
  fail(`expected version “${String(expectedVersion)}” is not a valid SemVer without a v prefix`);
}

if (packageJson && (Array.isArray(packageJson) || typeof packageJson !== 'object')) {
  fail('package.json must contain a JSON object');
}

const manifest = readJson('manifest.json');
if (!manifest || Array.isArray(manifest) || typeof manifest !== 'object') {
  fail('manifest.json must contain a JSON object');
}
for (const field of ['id', 'name', 'version', 'minAppVersion', 'description', 'author', 'isDesktopOnly']) {
  if (!(field in manifest)) fail(`manifest.json is missing ${field}`);
}
for (const field of ['id', 'name', 'version', 'minAppVersion', 'description', 'author']) {
  if (typeof manifest[field] !== 'string' || !manifest[field].trim()) {
    fail(`manifest.json ${field} must be a nonempty string`);
  }
}
if (manifest.id !== 'templar') fail(`manifest.json id must be templar, got ${String(manifest.id)}`);
if (manifest.version !== expectedVersion) fail(`manifest.json version ${String(manifest.version)} does not match ${expectedVersion}`);
if (typeof manifest.minAppVersion !== 'string' || !semver.valid(manifest.minAppVersion)) {
  fail('manifest.json minAppVersion must be a valid nonempty version string');
}
if (typeof manifest.isDesktopOnly !== 'boolean') fail('manifest.json isDesktopOnly must be boolean');

requireFile('main.js', (path) => statSync(path).size > 10_000);
requireFile('styles.css', (path) => statSync(path).size > 0);
requireFile('SHA256SUMS.txt', (path) => statSync(path).size > 0);

const checksumLines = readFileSync(resolve(artifactRoot, 'SHA256SUMS.txt'), 'utf8').trimEnd().split('\n');
if (checksumLines.length !== 3) fail('SHA256SUMS.txt must contain exactly three asset checksums');
for (const [index, name] of ['main.js', 'manifest.json', 'styles.css'].entries()) {
  const match = /^([0-9a-f]{64}) {2}([^\n]+)$/.exec(checksumLines[index]);
  if (!match || match[2] !== name) fail(`SHA256SUMS.txt must list ${name} in order with two spaces`);
  const actual = createHash('sha256').update(readFileSync(resolve(artifactRoot, name))).digest('hex');
  if (actual !== match[1]) fail(`SHA256SUMS.txt hash mismatch for ${name}`);
}

if (strictBundle) {
  const metadata = readJson('release-metadata.json');
  if (metadata.tag !== expectedVersion) fail('release-metadata.json tag does not match the requested version');
  if (metadata.title !== `Templar ${expectedVersion}`) fail('release-metadata.json title is incorrect');
  if (metadata.prerelease !== (semver.prerelease(expectedVersion) !== null)) fail('release-metadata.json prerelease flag is incorrect');
  if (JSON.stringify(metadata.assets) !== JSON.stringify(publicAssets)) {
    fail('release-metadata.json assets must be the exact public asset set');
  }
}

console.log(`BRAT release contract verified for ${expectedVersion}.`);
