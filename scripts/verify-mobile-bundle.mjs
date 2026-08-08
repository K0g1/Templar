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
