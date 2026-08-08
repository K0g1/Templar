# Templar Template Specification v1

## Overview

A Page Style is structured visual data plus optional advanced CSS. Library exports use a top-level `templar-template` mapping. Notes use a top-level `templar` mapping and additionally store their page mode.

Unknown fields are discarded during import. Missing fields receive defaults. Current import supports only version 1.

The highlight color pair was added compatibly within v1: older v1 styles that omit it receive the safe default pair, while every new export writes both fields.

## Template versus note data

A reusable template does not contain `page`; the user chooses paged or pageless when creating/applying it. A note contains the full template copy plus:

```yaml
page:
  mode: pageless
  size: a4
  width: 794
  height: 1123
  gap: 32
  scale-to-fit: true
```

This separation is intentional: all templates must support both modes.

## Complete export shape

```yaml
templar-template:
  version: 1
  style-name: Classic Ruled
  template-id: classic-ruled
  source-template-id: classic-ruled
  metadata:
    author: Templar
    description: Warm ruled paper with a measured baseline.
    tags: [journal, ruled, warm]
  paper:
    color: "#fffdf4"
    pattern: ruled
    pattern-color: "rgba(107, 155, 190, 0.43)"
    major-pattern-color: "rgba(79, 125, 160, 0.55)"
    margin-line: true
    margin-color: "rgba(210, 92, 92, 0.62)"
    margin-offset: 72
  baseline:
    enabled: true
    mode: strict
    unit: 30
    snap-images: true
  typography:
    body-font: 'Georgia, "Times New Roman", serif'
    body-size: 18
    body-weight: 400
    text-color: "#302e2b"
    muted-color: "#706c66"
  headings:
    h1:
      font: 'Georgia, "Times New Roman", serif'
      size: 42
      weight: 700
      color: "#302e2b"
      decoration: none
    h2:
      font: 'Georgia, "Times New Roman", serif'
      size: 31
      weight: 700
      color: "#393631"
      decoration: none
    h3:
      font: 'Georgia, "Times New Roman", serif'
      size: 24
      weight: 700
      color: "#46413b"
      decoration: none
    h4:
      font: 'Georgia, "Times New Roman", serif'
      size: 20
      weight: 700
      color: "#514b44"
      decoration: none
  layout:
    max-width: 820
    padding-top: 60
    padding-right: 72
    padding-bottom: 120
    padding-left: 96
    page-radius: 0
    page-shadow: none
  images:
    frame: polaroid
    border-width: 10
    border-color: "#ffffff"
    bottom-border-width: 34
    corner-radius: 0
    rotation: -1.2
    shadow: "0 8px 20px rgba(69, 58, 42, 0.18)"
    max-width: 100
    top-spacing: 30
    bottom-spacing: 30
    opacity: 1
    sepia: 0
    grayscale: 0
    saturation: 1
    contrast: 1
  blocks:
    link-color: "#315f86"
    quote-accent: "#9fb8ca"
    quote-background: "rgba(159, 184, 202, 0.12)"
    quote-text-color: "#302e2b"
    code-background: "rgba(48, 46, 43, 0.08)"
    code-text-color: "#302e2b"
    code-font: '"SFMono-Regular", Consolas, "Liberation Mono", monospace'
    code-size: 16
    table-border: "rgba(48, 46, 43, 0.24)"
    table-header-background: "rgba(48, 46, 43, 0.07)"
    checkbox-accent: "#507b5c"
    highlight-background: "rgba(244, 210, 83, 0.48)"
    highlight-text-color: "#302e2b"
  css: |
    .page h1 {
      letter-spacing: -0.025em;
    }
```

## Field constraints

| Field | Constraint |
| --- | --- |
| version | exactly `1` |
| template-id | lowercase letters/digits and single hyphens |
| paper.pattern | `blank`, `ruled`, `dot-grid`, `graph` |
| baseline.mode | `strict`, `balanced`, `free` |
| baseline.unit | 12–96px |
| body-size | 8–72px |
| weights | 100–900 |
| heading decoration | `none`, `underline`, `rule`, `highlight` |
| layout max-width | 320–2400px |
| layout padding | 0–400px (bottom up to 600px) |
| combined padding | leaves at least 240×240px on the minimum 480×640px custom page |
| image frame | `none`, `thin`, `photo`, `polaroid`, `scrapbook`, `rounded`, `technical`, `dark`, `vintage` |
| image rotation | -15–15 degrees |
| image max-width | 10–100 percent |
| opacity/sepia/grayscale | 0–1 |
| saturation/contrast | 0–4 |
| block colors | valid CSS colors, including both highlight background and highlighted text |
| code size | 8–48px; baseline measured independently from body text |
| custom CSS | maximum 50 KB and safe virtual selectors only |

## Baseline behavior

- `strict`: body, blocks, headings, and image exits snap to the grid.
- `balanced`: body and list baselines remain aligned, but blocks are packed on consecutive grid rows instead of reserving an empty row.
- `free`: no baseline enforcement; best for blank/sketch layouts.

Font size and grid unit are independent. Templar measures the requested font stack after loading. Its inline probe ends exactly at the browser's text baseline, so the probe's bottom border-box edge is the baseline measurement (not its top edge). Templar positions the pattern at:

```text
page top + content top padding + measured baseline inside line box
```

Ruled, dot-grid, and graph paper all use that same vertical anchor and the effective content-left padding as their horizontal origin. A ruled stroke starts at the baseline and extends one CSS pixel downward. Ordinary glyph bodies therefore sit above the ink while descenders such as `g`, `p`, and `y` naturally cross it. Dot and graph intersections coincide with the text grid rather than an unrelated page origin.

In both gridded modes, every inter-block offset is a whole multiple of the grid unit. Reading View list items and Live Preview list lines explicitly use the body line-height, with Obsidian's theme list padding removed. This prevents paragraphs, bullets, and later blocks from drifting between Graph Paper lines.

Reading View preserves source blank-line counts with plugin-owned, grid-sized spacer blocks. The Markdown remains unchanged; removing Templar returns to standard Markdown whitespace behavior. Fenced-code blank lines are ignored by the spacer parser because they already render inside the code block.

Fenced code uses its own measured font baseline. Reading View receives complementary top/bottom padding whose total is one grid unit, while every code line uses the body grid line-height. This keeps the first code baseline, all following code lines, and the block after the fence on the paper ruling.

Heading line boxes round up to grid multiples. Extra top/bottom padding aligns the heading baseline while preserving a grid-multiple total.

The `blocks.highlight-background` and `blocks.highlight-text-color` fields always render together for `==highlighted text==` in Reading and Live Preview. Templates should choose the pair as one palette decision and maintain readable contrast; Templar does not inherit Obsidian's theme highlight colors.

## Virtual CSS vocabulary

Supported roots include:

```css
.page
.page-content
.page h1
.page h2
.page h3
.page h4
.page p
.page ul
.page ol
.page li
.page blockquote
.page img
.page table
.page code
.page pre
.page hr
.page a
.page mark
.page input[type="checkbox"]
```

Every selector must start with `.page` or `.page-content`. Descendants and pseudo-classes are allowed:

```css
.page a:hover { ... }
.page table th { ... }
.page blockquote::before { ... }
```

Invalid examples:

```css
body .page { ... }
.workspace h1 { ... }
h1 { ... }
```

Viewport media queries are prohibited because paged notes must not reflow when the window changes. Preference media queries for reduced motion, color scheme, and contrast are allowed.

Viewport/container units, `env()` lengths, `@container` queries, `!important`, and private `.templar-*` runtime classes are also prohibited. Templar reserves geometry and root typography declarations on `.page` and `.page-content` (width, height, padding, margin, overflow, positioning, transforms, zoom, font, and line height), because those declarations define the fixed canvas and measured baseline. Put decorative CSS on Markdown descendants and use the structured template fields for page geometry and base typography.

## Attachment overrides

A note may override individual attachments without changing Markdown:

```yaml
attachments:
  mountains.jpg:
    frame: polaroid
    rotation: -2
    width: 420
```

Current overrides support frame metadata, rotation, and pixel width. The renderer matches encoded attachment filenames in image sources; original files remain untouched.

## Compatibility and migrations

Template exports identify v1. H4 and the expanded quote/code/table palette are backward-compatible v1 additions: older styles receive defaults during normalization. A future v2 importer must explicitly migrate known v1 fields before normalization. Never silently reinterpret a v1 field with new units or semantics.
