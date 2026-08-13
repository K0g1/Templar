import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';

const bundle = await readFile(new URL('../main.js', import.meta.url), 'utf8');
const forbiddenModules = new Set([
  'electron',
  ...builtinModules.map((moduleName) => moduleName.replace(/^node:/, '')),
]);
const escapedModules = [...forbiddenModules]
  .sort((left, right) => right.length - left.length)
  .map((moduleName) => moduleName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
  .join('|');
const runtimeImport = new RegExp(
  String.raw`(?:require\s*\(|import\s*\()\s*["'](?:node:)?(?:${escapedModules})(?:\/[^"']*)?["']\s*\)`,
  'g',
);
const matches = [...bundle.matchAll(runtimeImport)].map((match) => match[0]);
const forbiddenGlobals = [
  ...bundle.matchAll(/\bBuffer\b/g),
  ...bundle.matchAll(/\bprocess\s*(?:\.|\[)/g),
  ...bundle.matchAll(/\brequire\s*\(\s*(?!["'])/g),
].map((match) => match[0]);

if (matches.length > 0 || forbiddenGlobals.length > 0) {
  const unique = [...new Set([...matches, ...forbiddenGlobals])].join(', ');
  throw new Error(
    `Mobile bundle check failed: main.js contains desktop runtime imports: ${unique}`,
  );
}

const metafileUrl = new URL('../main.js.meta.json', import.meta.url);
if (existsSync(metafileUrl)) {
  const metafile = JSON.parse(await readFile(metafileUrl, 'utf8'));
  const graphImports = Object.values(metafile.inputs ?? {})
    .flatMap((input) => input.imports ?? [])
    .map((entry) => entry.path)
    .filter((path) => typeof path === 'string');
  const forbiddenGraphImports = graphImports.filter((path) =>
    path === 'electron' || path.startsWith('node:') || forbiddenModules.has(path),
  );
  if (forbiddenGraphImports.length > 0) {
    throw new Error(
      `Mobile import graph check failed: ${[...new Set(forbiddenGraphImports)].join(', ')}`,
    );
  }
}
