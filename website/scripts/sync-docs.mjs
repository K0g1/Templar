import fs from 'node:fs/promises';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const root = path.resolve(website, '..');
const output = path.join(website, 'src/content/docs');
const base = (process.env.SITE_BASE ?? '/Templar').replace(/\/$/, '');
await fs.rm(output, { recursive: true, force: true });

const routes = [
  ['docs/README.md', 'start/introduction.md', 'Introduction'],
  ['docs/INSTALLATION.md', 'start/installation.md', 'Installation'],
  ['docs/TEMPLATE_SPEC.md', 'reference/template-spec.md', 'Template specification'],
  ['docs/PAGED_LAYOUT.md', 'reference/paged-layout.md', 'Paged layout'],
  ['docs/RECOVERY.md', 'reference/recovery.md', 'Recovery'],
  ['docs/DEVELOPER_REFERENCE.md', 'developers/developer-reference.md', 'Developer reference'],
  ['docs/ARCHITECTURE.md', 'developers/architecture.md', 'Architecture'],
  ['docs/SECURITY.md', 'developers/security.md', 'Security model'],
  ['docs/PERFORMANCE.md', 'developers/performance.md', 'Performance'],
  ['docs/MAINTAINER_GUIDE.md', 'developers/maintainer-guide.md', 'Maintainer guide'],
  ['docs/SCHEMA_MIGRATIONS.md', 'developers/schema-migrations.md', 'Schema migrations'],
  ['docs/REPOSITORY_GOVERNANCE.md', 'developers/repository-governance.md', 'Repository governance']
];

const routeMap = new Map(routes.map(([source, target]) => [path.basename(source), `${base}/docs/${target.replace(/\.md$/, '/')}`]));

function rewriteLinks(markdown) {
  return markdown.replace(/\]\((?:\.\.\/)?([^/)]+\.md)(#[^)]+)?\)/g, (full, file, hash = '') => {
    const route = routeMap.get(path.basename(file));
    return route ? `](${route}${hash})` : full;
  }).replace(/\]\(\.\.\/README\.md\)/g, `](${base}/)`);
}

for (const [source, target, title] of routes) {
  const markdown = rewriteLinks(await fs.readFile(path.join(root, source), 'utf8'));
  const destination = path.join(output, 'docs', target);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `---\ntitle: ${JSON.stringify(title)}\ndescription: Canonical Templar documentation synchronized from ${source}.\neditUrl: https://github.com/K0g1/Templar/edit/main/${source}\n---\n\n${markdown}\n`);
}

const releaseDir = path.join(root, 'docs/releases');
for (const file of await fs.readdir(releaseDir)) {
  if (!file.endsWith('.md')) continue;
  const version = file.slice(0, -3);
  const destination = path.join(output, 'docs', 'releases', file);
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, `---\ntitle: ${JSON.stringify(version)}\ndescription: Immutable Templar release notes for ${version}.\neditUrl: https://github.com/K0g1/Templar/edit/main/docs/releases/${file}\n---\n\n${await fs.readFile(path.join(releaseDir, file), 'utf8')}\n`);
}

const docsIndex = `---\ntitle: Documentation\ndescription: Everything you need to design beautiful notes and powerful systems with Templar.\ntemplate: splash\nhero:\n  tagline: Everything you need to design beautiful notes and powerful systems with Templar.\n  actions:\n    - text: Install Templar\n      link: ${base}/docs/start/installation/\n      icon: right-arrow\n      variant: primary\n    - text: Browse the reference\n      link: ${base}/docs/reference/template-spec/\n      icon: open-book\n---\n\n## I want to…\n\n- [Install Templar](${base}/docs/start/installation/)\n- [Understand paged mode](${base}/docs/reference/paged-layout/)\n- [Make a style](${base}/docs/reference/template-spec/)\n- [Recover protected data](${base}/docs/reference/recovery/)\n- [Understand the architecture](${base}/docs/developers/architecture/)\n- [Read the security model](${base}/docs/developers/security/)\n`;
await fs.mkdir(path.join(output, 'docs'), { recursive: true });
await fs.writeFile(path.join(output, 'docs', 'index.md'), docsIndex.replace('\ntemplate: splash\n', '\ntemplate: splash\neditUrl: false\n'));

const notFound = `---
title: Page not found
description: The requested Templar page could not be found.
template: splash
editUrl: false
hero:
  title: This page slipped out of the notebook.
  tagline: The link may be old, or the page may have moved. Start again from a known page.
  actions:
    - text: Return home
      link: ${base}/
      icon: right-arrow
      variant: primary
    - text: Open the docs
      link: ${base}/docs/
      icon: open-book
---
`;
await fs.writeFile(path.join(output, '404.md'), notFound);
