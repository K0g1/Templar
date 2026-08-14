import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

const website = path.resolve(import.meta.dirname, '..');
const assetsDir = path.join(website, 'src', 'assets');
const componentsDir = path.join(website, 'src', 'components', 'art');
const publicDir = path.join(website, 'public');

const source = await fs.readFile(path.join(assetsDir, 'logo-source.svg'), 'utf8');

// --- classify the source elements (machine-generated; order matters) ---
const ELEMENT_RE = new RegExp('<(?:line|circle|path) [^>]*?/?>', 'g');
const elements = source.match(ELEMENT_RE) ?? [];

const role = (el) => {
  if (/fill="none" stroke="#767a77"/.test(el)) return 'fold';
  if (/stroke="#767a77"/.test(el)) return 'graphite';
  if (/stroke="#8ea9b8"/.test(el)) return 'blue';
  if (/stroke="#b97972"/.test(el)) return 'red';
  if (/stroke="#92a29b"/.test(el)) return 'grid';
  if (/stroke="#7d8f77"/.test(el)) return 'divider';
  if (/<circle/.test(el)) return 'dot';
  if (/fill="#20201f"/.test(el)) return 'wordmark';
  if (/fill="#7d8f77"/.test(el)) return 'subtitle';
  return null;
};

const pick = (...roles) => elements.filter((el) => roles.includes(role(el)));

const svgWrap = (body, viewBox, title, desc) =>
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="' + viewBox + '" role="img" aria-labelledby="title desc">\n' +
  '<title id="title">' + title + '</title>\n' +
  '<desc id="desc">' + desc + '</desc>\n' +
  body + '\n</svg>';

// --- 1. compact page mark ------------------------------------------------
// Same geometry as the source mark, scaled into a 64x64 box with stroke
// weights normalized so the page stays legible at 16-46px render sizes.
const MARK = { x0: 143, x1: 457, y0: 132, y1: 523 };
const S = 50 / (MARK.y1 - MARK.y0);
const CX = (MARK.x0 + MARK.x1) / 2;
const CY = (MARK.y0 + MARK.y1) / 2;
const px = (x) => +(32 + (x - CX) * S).toFixed(2);
const py = (y) => +(32 + (y - CY) * S).toFixed(2);

const dotRows = [
  [196, [198, 222, 246, 270, 294, 318]],
  [215, [198, 222, 246, 270, 294, 318]],
  [234, [198, 222, 246, 270, 294, 318, 342]],
  [253, [198, 222, 246, 270, 294, 318, 342]],
];
const ruledYs = [294, 313, 332, 351, 370];
const gridXs = Array.from({ length: 13 }, (_, i) => 198 + i * 17);
const gridYs = [394, 411, 428, 445, 462];

const markBody = (colorOf) =>
  '  <g stroke="' + colorOf('graphite') + '" stroke-width="2.1" opacity="0.88" stroke-linecap="square" fill="none">\n' +
  '    <line x1="' + px(166) + '" y1="' + py(132) + '" x2="' + px(166) + '" y2="' + py(523) + '"/>\n' +
  '    <line x1="' + px(143) + '" y1="' + py(500) + '" x2="' + px(457) + '" y2="' + py(500) + '"/>\n' +
  '    <line x1="' + px(156) + '" y1="' + py(157) + '" x2="' + px(372) + '" y2="' + py(157) + '"/>\n' +
  '    <path d="M' + px(372) + ' ' + py(157) + ' L' + px(434) + ' ' + py(219) + ' V' + py(500) + '" stroke-linejoin="miter"/>\n' +
  '    <path d="M' + px(372) + ' ' + py(157) + ' V' + py(219) + ' H' + px(434) + '" stroke-linejoin="miter"/>\n' +
  '  </g>\n' +
  '  <g fill="' + colorOf('dot') + '" opacity="0.78">\n' +
  '    ' + dotRows.flatMap(([y, xs]) => xs.map((x) => '<circle cx="' + px(x) + '" cy="' + py(y) + '" r="1.4"/>')).join('\n    ') + '\n' +
  '  </g>\n' +
  '  <g stroke="' + colorOf('blue') + '" stroke-width="1.3" opacity="0.68" stroke-linecap="round">\n' +
  '    ' + ruledYs.map((y) => '<line x1="' + px(198) + '" y1="' + py(y) + '" x2="' + px(402) + '" y2="' + py(y) + '"/>').join('\n    ') + '\n' +
  '  </g>\n' +
  '  <line x1="' + px(236) + '" y1="' + py(282) + '" x2="' + px(236) + '" y2="' + py(378) + '" stroke="' + colorOf('red') + '" stroke-width="1.5" opacity="0.78" stroke-linecap="round"/>\n' +
  '  <g stroke="' + colorOf('grid') + '" stroke-width="0.75" opacity="0.36" stroke-linecap="square">\n' +
  '    ' + gridXs.map((x) => '<line x1="' + px(x) + '" y1="' + py(394) + '" x2="' + px(x) + '" y2="' + py(463) + '"/>').join('\n    ') + '\n' +
  '    ' + gridYs.map((y) => '<line x1="' + px(198) + '" y1="' + py(y) + '" x2="' + px(402) + '" y2="' + py(y) + '"/>').join('\n    ') + '\n' +
  '  </g>';

const LIGHT = { graphite: '#767a77', dot: '#9da19e', blue: '#8ea9b8', red: '#b97972', grid: '#92a29b' };
const DARK = { graphite: '#c6c9c3', dot: '#a9aca7', blue: '#9db6c4', red: '#d49a91', grid: '#a2afa5' };

const markSvg = (palette, title) =>
  svgWrap(
    markBody((roleName) => palette[roleName]),
    '0 0 64 64',
    title,
    'A folded page icon demonstrating dot grid, ruled notebook paper with a margin, and graph paper.'
  );

const markLight = markSvg(LIGHT, 'Templar');
const markDark = markSvg(DARK, 'Templar');

await fs.writeFile(path.join(assetsDir, 'logo-mark-light.svg'), markLight);
await fs.writeFile(path.join(assetsDir, 'logo-mark-dark.svg'), markDark);
await fs.writeFile(path.join(publicDir, 'favicon.svg'), markLight);

// --- 2. inline Astro components (theme-aware via --lg-* vars) ------------------
const VARS = { graphite: 'var(--lg-graphite)', dot: 'var(--lg-dot)', blue: 'var(--lg-blue)', red: 'var(--lg-red)', grid: 'var(--lg-grid)' };
const markVarBody = markBody((roleName) => VARS[roleName]).replace(new RegExp('^  ', 'gm'), '');

await fs.writeFile(
  path.join(componentsDir, 'LogoMark.astro'),
  '---\n' +
  'interface Props { class?: string }\n' +
  'const { class: className } = Astro.props;\n' +
  '---\n' +
  '<svg class={className} viewBox="0 0 64 64" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">' + markVarBody + '\n</svg>\n'
);

// Full lockup: mark + sage divider + wordmark + two-line subtitle, cropped tight.
const lockupVarBody = [
  ...pick('graphite', 'fold', 'dot', 'blue', 'red', 'grid'),
  ...pick('divider'),
  ...pick('wordmark'),
  ...pick('subtitle'),
]
  .map((el) =>
    el.replace(/(fill|stroke)="(#[0-9a-f]{6})"/g, (_m, attr) => {
      const r = role(el);
      if (attr === 'fill' && r === 'dot') return 'fill="var(--lg-dot)"';
      if (attr === 'fill' && r === 'wordmark') return 'fill="var(--lg-ink)"';
      if (attr === 'fill' && r === 'subtitle') return 'fill="var(--lg-sage)"';
      if (attr === 'stroke') {
        const v = r === 'divider' ? 'var(--lg-sage)' : VARS[r];
        return 'stroke="' + v + '"';
      }
      return _m;
    })
  )
  .join('\n');

await fs.writeFile(
  path.join(componentsDir, 'LogoLockup.astro'),
  '---\n' +
  'interface Props { class?: string }\n' +
  'const { class: className } = Astro.props;\n' +
  '---\n' +
  '<svg class={className} viewBox="128 84 1178 448" role="img" aria-label="Templar — page styling for Markdown notes" xmlns="http://www.w3.org/2000/svg">\n' +
  lockupVarBody + '\n</svg>\n'
);

// --- 3. OG social card ---------------------------------------------------------
const project = JSON.parse(await fs.readFile(path.join(website, 'src', 'data', 'project.generated.json'), 'utf8'));
const betaMarker = project.version.indexOf('-beta.');
const versionShort = betaMarker === -1 ? project.version : project.version.slice(0, betaMarker);
const stageLabel = project.stage.charAt(0).toUpperCase() + project.stage.slice(1);
const footer = (stageLabel + ' ' + versionShort + ' \u00b7 ' + project.builtInStyleCount + ' built-in styles \u00b7 No telemetry \u00b7 MIT').toUpperCase();

const lockupNoRect = [
  ...pick('graphite', 'fold', 'dot', 'blue', 'red', 'grid'),
  ...pick('divider'),
  ...pick('wordmark'),
  ...pick('subtitle'),
].join('\n');

const ogSvg =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">\n' +
  '  <defs>\n' +
  '    <filter id="grain" x="0" y="0" width="100%" height="100%">\n' +
  '      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>\n' +
  '      <feColorMatrix type="matrix" values="0 0 0 0 0.35 0 0 0 0 0.27 0 0 0 0 0.15 0 0 0 0.045 0"/>\n' +
  '    </filter>\n' +
  '  </defs>\n' +
  '  <rect width="1200" height="630" fill="#f5f4f2"/>\n' +
  '  <rect width="1200" height="630" filter="url(#grain)"/>\n' +
  '  <rect x="72" y="66" width="1094" height="558" rx="14" fill="rgba(48,38,24,0.09)"/>\n' +
  '  <rect x="63" y="57" width="1104" height="566" rx="14" fill="rgba(48,38,24,0.13)"/>\n' +
  '  <rect x="55" y="49" width="1096" height="566" rx="12" fill="#fdfaf0" stroke="rgba(74,60,40,0.16)"/>\n' +
  '  <g transform="translate(107 78) scale(0.42)">' + lockupNoRect + '</g>\n' +
  '  <text x="107" y="446" font-family="Georgia, Palatino, serif" font-size="44" font-weight="600" fill="#241d13">Give every Markdown note</text>\n' +
  '  <text x="107" y="498" font-family="Georgia, Palatino, serif" font-size="44" font-style="italic" font-weight="600" fill="#8a3b2c">its own visual identity.</text>\n' +
  '  <text x="107" y="536" font-family="Georgia, Palatino, serif" font-size="22" fill="#4a4132">A self-contained visual page design for every note \u2014 while the note stays pure Markdown.</text>\n' +
  '  <text x="107" y="580" font-family="Inter, Helvetica, Arial, sans-serif" font-size="18" font-weight="700" letter-spacing="2.5" fill="#78694f">' + footer + '</text>\n' +
  '</svg>';

const ogPng = await sharp(Buffer.from(ogSvg), { density: 144 }).resize(1200, 630, { fit: 'fill' }).png().toFile(path.join(publicDir, 'og.png'));
console.log('Wrote brand assets:');
console.log('  src/assets/logo-mark-light.svg');
console.log('  src/assets/logo-mark-dark.svg');
console.log('  public/favicon.svg');
console.log('  public/og.png (' + ogPng.format + ' ' + ogPng.width + 'x' + ogPng.height + ')');
console.log('  src/components/art/LogoMark.astro');
console.log('  src/components/art/LogoLockup.astro');
