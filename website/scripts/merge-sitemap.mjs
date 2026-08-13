// merge-sitemap.mjs — writes a single /Templar/sitemap.xml combining the
// Astro-generated sitemap index and its children. Crawlers conventionally
// look for sitemap.xml even though Astro emits sitemap-index.xml.
import fs from 'node:fs/promises';
import path from 'node:path';

const dist = path.resolve(import.meta.dirname, '../dist');
const base = (process.env.SITE_BASE ?? '/Templar').replace(/\/$/, '');
const site = (process.env.SITE_URL ?? 'https://k0g1.github.io').replace(/\/$/, '');

const urls = [];
const indexFile = path.join(dist, 'sitemap-index.xml');
const index = await fs.readFile(indexFile, 'utf8');
for (const match of index.matchAll(/<loc>([^<]+)<\/loc>/g)) {
  const childUrl = match[1];
  const childName = childUrl.split('/').pop();
  const childFile = path.join(dist, childName);
  try {
    const child = await fs.readFile(childFile, 'utf8');
    for (const childMatch of child.matchAll(/<url>[\s\S]*?<\/url>/g)) {
      urls.push(childMatch[0].trim());
    }
  } catch (error) {
    console.warn('Sitemap child missing:', childName, error.message);
  }
}

const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>\n';
await fs.writeFile(path.join(dist, 'sitemap.xml'), xml);
console.log('Wrote dist/sitemap.xml with', urls.length, 'URLs (base ' + base + ').');

