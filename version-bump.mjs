import { readFileSync, writeFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
const versions = JSON.parse(readFileSync('versions.json', 'utf8'));

manifest.version = packageJson.version;
versions[packageJson.version] = manifest.minAppVersion;

writeFileSync('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
writeFileSync('versions.json', `${JSON.stringify(versions, null, 2)}\n`);
