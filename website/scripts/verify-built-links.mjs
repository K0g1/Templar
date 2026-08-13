import fs from 'node:fs/promises';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const dist = path.join(website, 'dist');
const files = [];
async function walk(dir) {
  for (const item of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, item.name);
    if (item.isDirectory()) await walk(full);
    else if (item.name.endsWith('.html')) files.push(full);
  }
}
await walk(dist);
const base = (process.env.SITE_BASE ?? '/Templar').replace(/\/$/, '');
for (const file of files) {
  const html = await fs.readFile(file, 'utf8');
  for (const match of html.matchAll(/(?:href|src)="([^"]+)"/g)) {
    const url = match[1];
    if (!url.startsWith('/') || url.startsWith('//')) continue;
    if (base && !url.startsWith(`${base}/`) && url !== base) throw new Error(`Unbased internal URL ${url} in ${file}`);
  }
}
console.log(`Verified internal base paths in ${files.length} generated pages.`);
