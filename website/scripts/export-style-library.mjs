// export-style-library.mjs — bundles the plugin's complete built-in style
// library (132 templates) into a committed CJS bundle so the website CI,
// which installs only website dependencies, can render every style.
// Run from the website directory after template changes:
//   node scripts/export-style-library.mjs
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const websiteDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rootDir = path.resolve(websiteDir, '..');
const { build } = await import(path.join(rootDir, 'node_modules', 'esbuild', 'lib', 'main.js'));

const entry = path.join(websiteDir, 'scripts', 'vendor', 'style-library-entry.ts');
const outfile = path.join(websiteDir, 'scripts', 'vendor', 'style-library.bundle.cjs');
await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile,
  logLevel: 'warning',
});
console.log('Wrote ' + path.relative(websiteDir, outfile));
