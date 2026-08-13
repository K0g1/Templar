import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const root = path.resolve(website, '..');
const changelog = await fs.readFile(path.join(root, 'CHANGELOG.md'), 'utf8');
const matches = [...changelog.matchAll(/^##\s+([^\n—]+?)\s+—\s+(\d{4}-\d{2}-\d{2})\n([\s\S]*?)(?=^##\s+|(?![\s\S]))/gm)];
const releases = matches.map((match) => {
  const version = match[1].trim();
  const body = match[3].trim();
  const bullets = [...body.matchAll(/^-\s+(.+)$/gm)].map((item) => item[1]);
  const stage = version.includes('beta') ? 'beta' : version.includes('alpha') ? 'alpha' : 'stable';
  // Starlight slugifies release-doc file names by stripping dots, so the
  // route slug matches the condensed form (1.1.0-alpha.1 -> 110-alpha1).
  const slug = version.replace(/\./g, '').replace(/-(alpha|beta)/, '-$1');
  const hasNotes = fsSync.existsSync(path.join(root, 'docs/releases', version + '.md'));
  return { version, slug, hasNotes, date: match[2], stage, summary: bullets[0] ?? '', bullets, body };
});

await fs.mkdir(path.join(website, 'src/data'), { recursive: true });
await fs.writeFile(path.join(website, 'src/data/releases.generated.json'), `${JSON.stringify(releases, null, 2)}\n`);
