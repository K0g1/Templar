# Documentation asset optimization

On 2026-08-11, the six documentation/showcase screenshots were converted from PNG to lossless WebP. The pixel dimensions and visual content were preserved; the images were inspected after conversion. WebP is supported by the GitHub Markdown gallery and Obsidian image embeds used by the showcase notes.

| File | Before bytes | After bytes | Reduction | Format changed? |
| --- | ---: | ---: | ---: | --- |
| `docs/assets/gallery/botanical-field-notes` | 242,313 | 134,788 | 44.37% | PNG → WebP |
| `docs/assets/gallery/neon-night-brief` | 287,464 | 166,804 | 41.97% | PNG → WebP |
| `docs/assets/gallery/alpine-field-log` | 353,736 | 213,888 | 39.53% | PNG → WebP |
| `examples/Templar Showcase/Assets/neon-night` | 2,073,586 | 1,571,092 | 24.23% | PNG → WebP |
| `examples/Templar Showcase/Assets/alpine-blue-hour` | 2,503,654 | 1,857,190 | 25.82% | PNG → WebP |
| `examples/Templar Showcase/Assets/botanical-journal` | 2,679,056 | 1,681,880 | 37.22% | PNG → WebP |

No generated or release artifacts were changed. References in the README and showcase notes now point to the WebP assets.
