// write-404.mjs — replaces the generated 404.html with a self-contained,
// on-brand standalone page so unmatched paths under /Templar get the site's
// own stationery design instead of the docs layout.
import fs from 'node:fs/promises';
import path from 'node:path';

const website = path.resolve(import.meta.dirname, '..');
const dist = path.join(website, 'dist');
const base = (process.env.SITE_BASE ?? '/Templar').replace(/\/$/, '');
const emblem = await fs.readFile(path.join(website, 'src/assets/emblem.svg'), 'utf8');

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#efe4cd">
<title>Page not found — Templar</title>
<meta name="description" content="The requested Templar page could not be found.">
<meta name="robots" content="noindex">
<link rel="icon" href="${base}/favicon.svg" type="image/svg+xml">
<style>
  :root { --desk-0:#efe4cd; --desk-1:#e6d8bc; --paper-0:#fdfaf0; --paper-2:#ecdec2; --ink-1:#241d13; --ink-2:#4a4132; --ink-muted:#78694f; --oxblood:#8a3b2c; --olive:#5f6d44; --brass:#a37c3c; --line:rgba(74,60,40,.16); --display:"Iowan Old Style","Palatino Linotype","Book Antiqua",Palatino,Georgia,"Times New Roman",serif; --ui:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 32px 18px; color: var(--ink-1); font-family: var(--ui); background: radial-gradient(1200px 700px at 18% -8%, rgba(255,250,235,.5), transparent 55%), linear-gradient(180deg, var(--desk-0), var(--desk-1)); }
  .card { position: relative; width: min(640px, 100%); padding: 56px 44px 64px; text-align: center; background: var(--paper-0); border: 1px solid rgba(85,63,39,.14); border-radius: 6px; box-shadow: 0 16px 36px rgba(48,38,24,.14), 0 2px 6px rgba(48,38,24,.08); }
  .card::after { content: ''; position: absolute; left: 1.5%; right: 1.5%; bottom: -7px; height: 9px; background: var(--paper-2); clip-path: polygon(0 0, 2.5% 42%, 6% 9%, 11% 48%, 17% 13%, 24% 46%, 30% 8%, 38% 50%, 45% 12%, 53% 47%, 61% 10%, 70% 49%, 78% 14%, 86% 46%, 93% 9%, 100% 0, 100% 100%, 0 100%); }
  .seal { width: 108px; height: 108px; margin: 0 auto 22px; }
  .eyebrow { display: inline-flex; align-items: center; gap: 8px; font: 700 .74rem/1 var(--ui); text-transform: uppercase; letter-spacing: .12em; color: var(--oxblood); background: rgba(138,59,44,.08); border: 1px solid rgba(138,59,44,.22); padding: 8px 12px; border-radius: 999px; }
  h1 { font-family: var(--display); font-weight: 600; font-size: clamp(2.1rem, 6vw, 3.2rem); letter-spacing: -.03em; margin: 22px 0 14px; }
  p { color: var(--ink-2); font-family: var(--display); font-size: 1.08rem; line-height: 1.6; margin: 0 auto; max-width: 460px; }
  .actions { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; margin-top: 32px; }
  .button { display: inline-flex; align-items: center; gap: 9px; min-height: 46px; padding: 11px 20px; border-radius: 6px; text-decoration: none; font-weight: 700; font-size: .95rem; border: 1px solid rgba(74,60,40,.3); background: rgba(253,250,240,.72); color: var(--ink-1); }
  .button.primary { background: linear-gradient(#8f4130,#7a3223); color: #fff7ee; border-color: #6e2d21; }
  .fleuron { color: var(--brass); width: 220px; margin: 0 auto; opacity: .8; }
  a:focus-visible { outline: 3px solid color-mix(in srgb, var(--olive), white 25%); outline-offset: 3px; border-radius: 2px; }
</style>
</head>
<body>
  <main class="card">
    <div class="seal">${emblem}</div>
    <span class="eyebrow">Error 404</span>
    <h1>This page slipped out of the notebook.</h1>
    <p>The link may be old, or the page may have moved. The rest of the desk is right where you left it.</p>
    <svg class="fleuron" viewBox="0 0 320 64" fill="none" aria-hidden="true"><g stroke="currentColor" stroke-width="1.6" fill="none"><path d="M8 32 H118" stroke-opacity="0.65"/><path d="M202 32 H312" stroke-opacity="0.65"/><g stroke-width="1.3"><path d="M160 12 C162 20 162 26 160 32 C158 38 158 44 160 52"/><path d="M148 16 C150 24 151 28 152 32 C151 36 150 40 148 48"/><path d="M172 16 C170 24 169 28 168 32 C169 36 170 40 172 48"/></g><path d="M160 6 l4.5 4.5 L160 15 l-4.5 -4.5 Z" fill="currentColor"/><path d="M160 49 l4.5 4.5 L160 58 l-4.5 -4.5 Z" fill="currentColor"/><circle cx="160" cy="32" r="3.4" fill="currentColor"/></g></svg>
    <div class="actions">
      <a class="button primary" href="${base}/">Return home</a>
      <a class="button" href="${base}/docs/">Open the docs</a>
    </div>
  </main>
</body>
</html>`;

await fs.writeFile(path.join(dist, '404.html'), html);
console.log('Wrote standalone dist/404.html (' + html.length + ' bytes).');

