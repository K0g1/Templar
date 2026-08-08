import { VIRTUAL_SELECTORS } from '../constants';

export const TEMPLAR_LLM_AUTHORING_KIT = `# Templar Template Authoring Skill

Specification: Templar Template Specification v1

## Your task

Create one complete, portable Templar Page Style. Return only a YAML document with a top-level \`templar-template\` key. The style must decorate Markdown without changing the Markdown body.

## Core rules

1. Styling belongs to the note. Never rely on a vault CSS snippet or theme.
2. Use Templar virtual selectors only. Never target Obsidian internals, \`html\`, \`body\`, \`:root\`, \`.workspace\`, sidebars, tabs, settings, or modals.
3. Every CSS selector must start with \`.page\` or \`.page-content\`.
4. Ruled layouts must use \`paper.pattern: ruled\` and the baseline engine. Do not draw independent horizontal rules at guessed offsets.
5. Fonts need a fallback stack. Templar measures the chosen font and positions paper rules from its real browser baseline.
6. Keep font size and vertical rhythm independent. A 16px font on a 30px grid is valid.
7. Use grid-multiple heading sizes and spacing where practical. Templar automatically fits heading line boxes and corrects their baselines.
8. Images must preserve infinite vertical scrolling and should not use fixed positioning. Templar can snap their outer block back to the grid.
9. Do not load URLs, fonts, scripts, images, or imports from CSS. The template must remain self-contained.
10. Avoid infinite animation, backdrop filters, oversized shadows, and other effects that make long-note scrolling expensive.
11. Never hide the whole page or interfere with editing controls.
12. The note must remain readable ordinary Markdown if Templar is disabled.
13. Do not use viewport-width media queries. A Page Style must render on a fixed page without changing text positions when the window is resized. Preference queries for reduced motion, color scheme, or contrast are allowed.
14. Do not use viewport/container units, environment-dependent lengths, container queries, \`!important\`, or private \`.templar-*\` classes. Do not override geometry, zoom, transforms, overflow, base font, or line height directly on \`.page\` or \`.page-content\`; use the structured fields instead.
15. Always choose both a highlight background and a highlighted-text color with enough contrast for the template palette.

## Supported virtual selectors

${VIRTUAL_SELECTORS.map((selector) => `- \`${selector}\``).join('\n')}

Pseudo-classes, pseudo-elements, attribute selectors, and descendant selectors may extend these roots. For example, \`.page a:hover\` and \`.page table th\` are valid. A selector such as \`body .page\` is invalid because it does not start with the virtual page root.

## Schema

\`version\`: must be 1.

\`style-name\`: human-readable name.

\`template-id\`: lowercase letters, digits, and hyphens.

\`metadata\`: author, description, and a list of tags.

\`paper\`:
- \`color\`: CSS color.
- \`pattern\`: blank, ruled, dot-grid, or graph.
- \`pattern-color\` and \`major-pattern-color\`: CSS colors.
- \`margin-line\`: boolean.
- \`margin-color\`: CSS color.
- \`margin-offset\`: 0–400 pixels.

\`baseline\`:
- \`enabled\`: boolean.
- \`mode\`: strict, balanced, or free.
- \`unit\`: 12–96 pixels.
- \`snap-images\`: boolean.

\`typography\`:
- \`body-font\`: complete CSS font stack.
- \`body-size\`: 8–72 pixels.
- \`body-weight\`: 100–900.
- \`text-color\` and \`muted-color\`: CSS colors.

\`headings.h1\`, \`h2\`, \`h3\`, and \`h4\` each use \`font\`, \`size\`, \`weight\`, \`color\`, and \`decoration\`. Decoration is none, underline, rule, or highlight.

\`layout\`: \`max-width\`, four \`padding-*\` values, \`page-radius\`, and \`page-shadow\`.

\`images\`: \`frame\` (none, thin, photo, polaroid, scrapbook, rounded, technical, dark, vintage), \`border-width\`, \`border-color\`, \`bottom-border-width\`, \`corner-radius\`, \`rotation\` (-15 to 15), \`shadow\`, \`max-width\` (10–100 percent), \`top-spacing\`, \`bottom-spacing\`, \`opacity\`, \`sepia\`, \`grayscale\`, \`saturation\`, and \`contrast\`.

\`blocks\`: link/highlight colors; quote accent, background, and text; code background, text, font, and size; table border and header background; and checkbox accent.

\`css\`: optional advanced CSS using only the virtual selector vocabulary.

## Expected output shape

\`\`\`yaml
templar-template:
  version: 1
  style-name: Botanical Field Journal
  template-id: botanical-field-journal
  metadata:
    author: AI-assisted design
    description: A calm field notebook inspired by pressed leaves.
    tags: [botanical, journal, ruled]
  paper:
    color: "#f4f0da"
    pattern: ruled
    pattern-color: "rgba(83, 119, 92, 0.24)"
    major-pattern-color: "rgba(83, 119, 92, 0.34)"
    margin-line: true
    margin-color: "rgba(145, 91, 72, 0.48)"
    margin-offset: 74
  baseline:
    enabled: true
    mode: balanced
    unit: 30
    snap-images: true
  typography:
    body-font: 'Georgia, "Times New Roman", serif'
    body-size: 17
    body-weight: 400
    text-color: "#334137"
    muted-color: "#6d796d"
  headings:
    h1: { font: 'Georgia, serif', size: 42, weight: 700, color: "#355b43", decoration: rule }
    h2: { font: 'Georgia, serif', size: 30, weight: 700, color: "#43664d", decoration: none }
    h3: { font: 'Georgia, serif', size: 23, weight: 700, color: "#526f58", decoration: none }
    h4: { font: 'Georgia, serif', size: 19, weight: 700, color: "#5e7962", decoration: none }
  layout:
    max-width: 820
    padding-top: 60
    padding-right: 72
    padding-bottom: 120
    padding-left: 96
    page-radius: 0
    page-shadow: none
  images:
    frame: vintage
    border-width: 8
    border-color: "#f7f0d9"
    bottom-border-width: 18
    corner-radius: 2
    rotation: -1
    shadow: "0 8px 20px rgba(48, 58, 44, 0.20)"
    max-width: 100
    top-spacing: 30
    bottom-spacing: 30
    opacity: 1
    sepia: 0.12
    grayscale: 0
    saturation: 0.92
    contrast: 1.04
  blocks:
    link-color: "#3e6b50"
    quote-accent: "#6f8d70"
    quote-background: "rgba(79, 112, 82, 0.08)"
    quote-text-color: "#334137"
    code-background: "rgba(49, 65, 54, 0.08)"
    code-text-color: "#334137"
    code-font: '"SFMono-Regular", Consolas, monospace'
    code-size: 15
    table-border: "rgba(63, 87, 69, 0.28)"
    table-header-background: "rgba(79, 112, 82, 0.10)"
    checkbox-accent: "#4f7658"
    highlight-background: "rgba(151, 191, 157, 0.42)"
    highlight-text-color: "#26352b"
  css: |
    .page h1 {
      letter-spacing: -0.02em;
    }

    .page blockquote {
      font-style: italic;
    }
\`\`\`

Before responding, verify that every selector begins with \`.page\` or \`.page-content\`, every required section is present, no CSS URL is used, the layout can scroll forever, and the body content remains ordinary Markdown.
`;
