# Paged and pageless layout

The current implementation/source map and smoke-test handoff are in [`DEVELOPER_REFERENCE.md`](DEVELOPER_REFERENCE.md). This document is the geometry and pagination contract.

## Product contract

Every Templar template must render in both modes:

- **Pageless:** width follows the Markdown pane and text can rewrap when the pane changes.
- **Paged:** typography is laid out on a fixed-width sheet. Pane changes alter only the scale of the entire sheet; text positions and line breaks stay fixed.

The mode belongs to the note and is stored with the copied design. It is not a template variant.

## Persisted options

```yaml
page:
  mode: paged        # paged | pageless
  size: a4           # a4 | letter | custom
  width: 794         # CSS pixels
  height: 1123       # CSS pixels
  gap: 32            # requested visual gap
  scale-to-fit: true
```

Presets use 96-CSS-pixel approximations:

| Preset | Width | Height |
| --- | ---: | ---: |
| A4 | 794 | 1123 |
| US Letter | 816 | 1056 |

Custom dimensions are clamped to 480–1800px wide and 640–2400px high.

## Fixed-layout invariant

In paged mode, `.templar-page-content` always retains the stored CSS width. The pane never changes this layout width. `PageLayoutService` computes:

```text
scale = min(1, usable pane width / stored page width)
```

Usable width excludes the page root’s computed inline padding and a small sheet gutter. Fit-to-screen mode deliberately has no minimum scale: even a wide custom sheet fits a phone instead of silently overflowing. Templar writes only `--templar-page-scale`. The compiler applies that through CSS `zoom`, which scales visual and layout footprint together while descendants continue to calculate against the fixed unscaled page width.

DOM engines have historically disagreed about whether `getBoundingClientRect()` includes CSS `zoom`; WebKit only standardized zoom-scaled rectangle values in [Safari 26.4](https://webkit.org/blog/17862/webkit-features-for-safari-26-4/#zoom). Templar feature-detects the behavior on every layout pass by comparing the rendered content width with the stored fixed width, then uses that measured geometry factor for all pagination math. This keeps older iOS WebViews and Chromium on the same page coordinates.

This means:

- a 90-character line wraps at the same word in a full window, split pane, or phone;
- images using percentages calculate from the same page content box;
- font sizes and baseline positions remain fixed in page coordinates;
- the user can still scroll vertically through sheets.

If `scale-to-fit` is false, the scale remains 1 and the page can scroll horizontally in a narrow pane.

## Sheet surface

The page content has an isolated `::before` surface containing the template paper color and pattern. A repeating mask reveals one fixed-height sheet followed by a transparent gap, producing a PDF-like stack over Obsidian's secondary background.

The requested gap is adjusted upward to make this equation true:

```text
(page height + effective gap) modulo baseline unit = 0
```

Because the page span is a grid multiple, a continuous repeating ruling has the same phase at the top of every sheet. The paper therefore follows the measured font baseline on page 2 exactly as on page 1.

## Page-break fitting

CSS alone cannot paginate editable CodeMirror DOM vertically. `PageLayoutService` uses rendered-block fitting without rewriting Markdown:

1. Observe the page root, content, rendered break candidates, and images for size and child/text changes.
2. Coalesce work into one animation frame.
3. Clear prior computed break variables.
4. Enumerate visible top-level Reading blocks or CodeMirror lines/widgets.
5. Measure each block in unscaled page coordinates.
6. If a block would cross the printable bottom or begins in a gap, add a computed top-margin offset to the next sheet's content start.
7. Continue sequentially so later measurements include earlier breaks.

The offset uses CSS custom properties:

```css
margin-top: calc(
  var(--templar-original-margin-top) +
  var(--templar-page-break)
);
```

No Markdown text or renderer-owned node is moved. Clearing the style or switching to pageless removes all variables.

## Reading and Live Preview differences

Reading view exposes top-level rendered blocks. Templar avoids splitting a single block across wrappers; a block taller than the printable area is left intact rather than entering an infinite move loop.

Live Preview is CodeMirror 6 and virtualizes long documents. Templar fits currently rendered `.cm-line` and widget blocks. As CodeMirror changes the rendered viewport, MutationObserver schedules another pass. This keeps editing intact, though it is not a typesetting engine for splitting a single giant widget across sheets.

## Resize and font events

- Pane resize: recalculate scale, then page positions; fixed layout width does not change.
- Page style or mode change: rebuild scoped CSS and observers.
- Font/style change: FontMetricsService recalculates, compiler changes baseline variables, layout repaginates.
- Image load/resize: image compensation and page layout observers schedule new fitting.
- Plugin unload or leaf close: disconnect observers, cancel animation frames, remove scale/break properties.

## Mobile behavior

Paged mode uses only web-platform APIs available to Obsidian mobile: CSS, `ResizeObserver`, `MutationObserver`, animation frames, and DOM geometry. It does not use Electron, Node.js, filesystem paths, or desktop-only zoom controls.

The fixed canvas normally scales below 1 on a phone. Touch scrolling remains on the Obsidian page root, not a nested transformed overlay. Template custom CSS cannot use viewport-width media queries, preventing a template from silently changing its layout when a phone rotates or a split changes.

## Regression checks

For a paged renderer change:

1. Create the same long note in A4 and Letter.
2. Record line endings and page starts at a wide width.
3. resize the pane through at least five widths, including phone width.
4. Confirm line endings and page-start blocks remain identical while only apparent scale changes.
5. Edit near the top, middle, and bottom in Live Preview.
6. Load a late image and confirm later pages repaginate.
7. Switch paged → pageless → paged and confirm all computed style variables cleanly reset.
8. Test strict ruled and free blank templates.
9. Repeat with a missing first-choice font to exercise fallback metrics.
10. Run on physical iOS and Android before release.
