# Templar website QA plan

## Approach

QA is scripted against the built site (`website/dist`) served locally under the `/Templar` base, driven through the Chrome DevTools Protocol in headless Chrome. No changes to production code are made from the QA harness.

## Viewport matrix

Every named page is exercised at:

1. Desktop: 1440 × 1000
2. Tablet: 1024 × 900
3. Mobile: 390 × 844
4. 200% zoom approximation: 720 × 500

Pages: `/Templar/`, `/Templar/examples/`, `/Templar/installation/`, `/Templar/about/`, `/Templar/privacy/`, `/Templar/changelog/`, `/Templar/docs/`, a nested docs page, and a nonexistent URL (must render the custom 404 with working actions).

## Checks

- Horizontal overflow must never exceed the viewport on any page/width.
- All internal links resolve (crawl the built HTML; expect 200s; `/Templar` base preserved).
- Live notes: scoped stylesheets apply (paper background matches the style), content scrolls inside the window, tabs switch panes with correct `aria-selected`.
- Style demo: swatch selection swaps the preview; Apply shows the explicit-write state; preview language stays non-writing.
- Page-mode demo: Pageless/Paged toggle and the narrow-pane slider scale the sheet as a whole.
- Changelog filters: Stable/Beta/Alpha/All show exactly the matching releases.
- Theme toggle flips the night desk and persists through localStorage.
- Mobile menu: `aria-expanded` toggles, focus is visible, links activate.
- Copy buttons copy the exact repository/tag text (clipboard is wrapped so a rejected promise cannot crash the page).
- No-JavaScript pass: all content visible (reveal animations and demo panes are progressive enhancement), navigation remains usable.
- Dark desk: text on the desk keeps ≥ 4.5:1 contrast; paper panels keep dark ink on cream.
- Starlight docs follow the same theme toggle and keep the paper hero.

## Evidence

Each check is evaluated as a DOM assertion or screenshot artifact. Fixes land in the website sources, then the full build and verification scripts (`npm run check && npm run build`) must pass again.
