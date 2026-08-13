import fs from 'node:fs/promises';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const root = path.resolve(website, '..');
const manifest = JSON.parse(await fs.readFile(path.join(root, 'manifest.json'), 'utf8'));
const project = JSON.parse(await fs.readFile(path.join(website, 'src/data/project.generated.json'), 'utf8'));
const releases = JSON.parse(await fs.readFile(path.join(website, 'src/data/releases.generated.json'), 'utf8'));
if (project.version !== manifest.version) throw new Error('Generated version does not match manifest.json');
if (project.minAppVersion !== manifest.minAppVersion) throw new Error('Generated minimum Obsidian version does not match manifest.json');
if (releases[0]?.version !== manifest.version) throw new Error('Latest changelog entry does not match current release');
await fs.access(path.join(root, 'docs/releases', `${manifest.version}.md`));
const pages = await fs.readdir(path.join(website, 'src/pages'));
if (!pages.includes('installation.astro')) throw new Error('Installation page is missing');
const installation = await fs.readFile(path.join(website, 'src/pages/installation.astro'), 'utf8');
if (/install(?:ed)?\s+(?:from|via|with)\s+(?:the\s+)?Community Plugins/i.test(installation)) {
  throw new Error('Installation page incorrectly claims Community Plugins availability');
}
console.log(`Verified generated content for Templar ${manifest.version}.`);
