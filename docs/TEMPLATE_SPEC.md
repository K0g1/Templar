# Templar Template Specification v1

## Overview

A Page Style is structured visual data plus optional advanced CSS. Library exports use a top-level `templar-template` mapping. Notes use a top-level `templar` mapping and additionally store their page mode. For the current implementation's command/settings/source map, see [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md).

Unknown fields are discarded during import. Missing fields receive defaults. Current import supports only version 1.

The highlight color pair and template folder were added compatibly within v1: older v1 styles that omit them receive safe defaults, while every new export writes the fields explicitly. Folder names are portable display labels rather than filesystem paths; separators and reserved/control characters are flattened during import.

The 1.1 feature batch extends the same compatibility rule: h5/h6, heading letter spacing and text transform, the lists/watermark sections, the new paper patterns and pattern controls, image float/object-fit/duotone, and the expanded block palette are all optional v1 additions. Old styles import unchanged; new exports write the new fields explicitly.

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
    folder: Essentials
    tags: [journal, ruled, warm]
  paper:
    color: "#fffdf4"
    pattern: ruled
    pattern-color: "rgba(107, 155, 190, 0.43)"
    major-pattern-color: "rgba(79, 125, 160, 0.55)"
    pattern-opacity: 1
    pattern-scale: 1
    dot-radius: 1
    graph-major-interval: 5
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
    body-line-height: 0
    first-line-indent: 0
    drop-cap: false
    text-color: "#302e2b"
    muted-color: "#706c66"
  headings:
    h1:
      font: 'Georgia, "Times New Roman", serif'
      size: 42
      weight: 700
      color: "#302e2b"
      decoration: none
      letterSpacing: 0
      textTransform: none
    h2:
      font: 'Georgia, "Times New Roman", serif'
      size: 31
      weight: 700
      color: "#393631"
      decoration: none
      letterSpacing: 0
      textTransform: none
    h3:
      font: 'Georgia, "Times New Roman", serif'
      size: 24
      weight: 700
      color: "#46413b"
      decoration: none
      letterSpacing: 0
      textTransform: none
    h4:
      font: 'Georgia, "Times New Roman", serif'
      size: 20
      weight: 700
      color: "#514b44"
      decoration: none
      letterSpacing: 0
      textTransform: none
    h5:
      font: 'Georgia, "Times New Roman", serif'
      size: 17
      weight: 700
      color: "#5a534b"
      decoration: none
      letterSpacing: 0
      textTransform: none
    h6:
      font: 'Georgia, "Times New Roman", serif'
      size: 15
      weight: 700
      color: "#635c53"
      decoration: none
      letterSpacing: 0
      textTransform: none
  lists:
    marker-style: disc
    marker-color: "#706c66"
    indent-guides: false
    indent-guide-color: "rgba(48, 46, 43, 0.18)"
    nested-indent: 0
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
    float: none
    object-fit: contain
    duotone: none
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
    table-border-width: 1
    table-font-size: 15
    table-text-color: "#302e2b"
    table-header-text-color: "#302e2b"
    table-padding: 8
    table-striped: false
    table-stripe-color: "rgba(48, 46, 43, 0.045)"
    table-header-background: "rgba(48, 46, 43, 0.07)"
    checkbox-accent: "#507b5c"
    divider-color: "rgba(48, 46, 43, 0.35)"
    divider-width: 1
    divider-style: solid
    callout-accent: "#9fb8ca"
    callout-background: "rgba(159, 184, 202, 0.12)"
    callout-text-color: "#302e2b"
    callout-title-color: "#302e2b"
    callout-icon-color: "#9fb8ca"
    callout-border-width: 3
    callout-radius: 8
    callout-variants:
      warning:
        accent: "#c98b2e"
        background: "rgba(201, 139, 46, 0.12)"
        textColor: "#302e2b"
        titleColor: "#7a4d12"
        iconColor: "#c98b2e"
    embed-background: "rgba(48, 46, 43, 0.06)"
    embed-accent: "#9fb8ca"
    embed-radius: 10
    highlight-background: "rgba(244, 210, 83, 0.48)"
    highlight-text-color: "#302e2b"
  watermark:
    text: ""
    color: "rgba(48, 46, 43, 0.1)"
    size: 96
    rotation: -30
    opacity: 0.5
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
| metadata.folder | single-level display label, sanitized and capped at 80 characters; missing values become `Unfiled` |
| paper.pattern | `blank`, `ruled`, `ledger`, `dot-grid`, `graph`, `cross-hatch`, `diagonal`, `hex`, `scallop` |
| paper.pattern-opacity | 0–1 |
| paper.pattern-scale | 0.25–4 |
| paper.dot-radius | 0.5–6px |
| paper.graph-major-interval | 2–10 cells |
| baseline.mode | `strict`, `balanced`, `free` |
| baseline.unit | 12–96px |
| body-size | 8–72px |
| body-line-height | 0 (automatic) or 16–120px |
| first-line-indent | 0–120px (reading view only) |
| drop-cap | boolean |
| weights | 100–900 |
| heading decoration | `none`, `underline`, `rule`, `highlight` |
| heading text-transform | `none`, `uppercase`, `lowercase`, `capitalize` |
| heading letter-spacing | 0–10px |
| list marker-style | `disc`, `circle`, `square`, `none` (unordered lists) |
| list nested-indent | 0–120px (reading view only) |
| layout max-width | 320–2400px |
| layout padding | 0–400px (bottom up to 600px) |
| combined padding | leaves at least 240×240px on the minimum 480×640px custom page |
| image frame | `none`, `thin`, `photo`, `polaroid`, `scrapbook`, `rounded`, `technical`, `dark`, `vintage` |
| image float | `none`, `left`, `right` |
| image object-fit | `contain`, `cover`, `fill`, `scale-down` |
| image duotone | a hex color or `none` |
| image rotation | -15–15 degrees |
| image max-width | 10–100 percent |
| opacity/sepia/grayscale | 0–1 |
| saturation/contrast | 0–4 |
| block colors | valid CSS colors, including both highlight background and highlighted text |
| divider style | `solid`, `dashed`, `dotted`, `double`, `fade` |
| divider width | 1–20px |
| code size | 8–48px; baseline measured independently from body text |
| table border width | 0–12px |
| table font size | 8–48px |
| table padding | 0–40px |
| callout border width | 0–12px |
| callout/embed radius | 0–60px |
| callout variant key | letters, digits, and hyphens; each variant may override accent, background, text, title, and icon colors |
| watermark size | 24–240px |
| watermark rotation | -45–45 degrees |
| watermark opacity | 0.05–1 |
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

The additional patterns are decorative overlays, not baseline rules: ledger adds a second margin line to the ruled pattern, cross-hatch and diagonal tile 45-degree strokes at the grid unit (multiplied by `pattern-scale`), hex tiles an isometric lattice, and scallop staggers semicircles on the baseline. `pattern-opacity` fades every pattern color by mixing toward transparent; dot-grid uses `dot-radius` for the dot size; graph uses `graph-major-interval` for the heavy lines.

`typography.body-line-height` overrides the automatic rhythm (1.55 × body size, minimum 22px) when gridded modes are off. `first-line-indent` and `nested-indent` only apply in Reading View because Live Preview wraps every paragraph line as its own element. `drop-cap` floats the first letter of the first paragraph after a heading. Older v1 styles that omit H5/H6 receive the safe v1 defaults for those levels; a complete export writes all six heading levels.

`watermark.text` renders behind the page content (above the paper) as a rotated centered label at `watermark.size`, `rotation`, and `opacity`. Empty text hides it. The watermark sits below the content plane in both modes, so it never intercepts pointer events or selection.

`blocks.callout-variants` is keyed by Obsidian callout type (for example, `warning` for `> [!warning]`). A variant can override any subset of `accent`, `background`, `textColor`, `titleColor`, and `iconColor`; omitted values inherit the base callout palette. These nested keys are camelCase even though top-level persisted field names use kebab-case. The six nested heading objects also use the internal camelCase keys `letterSpacing` and `textTransform` because the canonical serializer preserves their object shape; `normalizeTemplate()` accepts the same internal form.

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
.page h5
.page h6
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

Template exports identify v1. H4, the expanded quote/code/table palette, and the 1.1 feature batch (h5/h6, heading letter spacing and text transform, lists and watermark, new paper patterns, image float/object-fit/duotone, and the extended block palette) are backward-compatible v1 additions: older styles receive defaults during normalization. A future v2 importer must explicitly migrate known v1 fields before normalization. Never silently reinterpret a v1 field with new units or semantics.
