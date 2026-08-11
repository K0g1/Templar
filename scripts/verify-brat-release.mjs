import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const repositoryRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const requestedVersion = process.argv[2];
const artifactRoot = resolve(process.argv[3] ?? repositoryRoot);

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

console.log(`BRAT release contract verified for ${expectedVersion}.`);
