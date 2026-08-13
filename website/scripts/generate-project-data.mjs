import fs from 'node:fs/promises';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const root = path.resolve(website, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
const versions = JSON.parse(await fs.readFile(path.join(root, 'versions.json'), 'utf8'));
const builtins = await fs.readFile(path.join(root, 'src/templates/builtins.ts'), 'utf8');
const catalog = await fs.readFile(path.join(root, 'src/templates/packs/catalog.ts'), 'utf8');

const expandedBlock = builtins.match(/const EXPANDED_BUILT_IN_TEMPLATES[\s\S]*?\] as const;/)?.[0] ?? '';
const coreStyleCount = (builtins.match(/^\s{2}builtIn\(/gm) ?? []).length + (expandedBlock.match(/^\s{2}aesthetic\(/gm) ?? []).length;
const packStyleCount = (catalog.match(/variantSeed:\s*\d+/g) ?? []).length;
const packNames = [...catalog.matchAll(/folder:\s*'([^']+)'/g)].map((match) => match[1]);
const uniquePacks = [...new Set(packNames)];
const prerelease = manifest.version.split('-')[1] ?? '';
const stage = prerelease.startsWith('beta') ? 'beta' : prerelease.startsWith('alpha') ? 'alpha' : 'stable';

const data = {
  name: manifest.name,
  pluginId: manifest.id,
  version: manifest.version,
  stage,
  minAppVersion: manifest.minAppVersion,
  isDesktopOnly: manifest.isDesktopOnly,
  schemaVersion: 1,
  builtInStyleCount: coreStyleCount + packStyleCount,
  coreStyleCount,
  packStyleCount,
  packCount: uniquePacks.length,
  packNames: uniquePacks,
  communityPluginListed: false,
  bratSupported: true,
  manualInstallSupported: true,
  repository: 'K0g1/Templar',
  license: pkg.license,
  versions
};

await fs.mkdir(path.join(website, 'src/data'), { recursive: true });
await fs.writeFile(path.join(website, 'src/data/project.generated.json'), `${JSON.stringify(data, null, 2)}\n`);
