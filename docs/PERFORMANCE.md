# Performance fixtures

The repository contains a repeatable benchmark suite for the high-risk paths identified in the audit. It is intentionally informational while the integration suite settles; it does not impose an arbitrary global threshold.

Run it with:

```bash
npm run bench
```

The pure fixtures cover 100/1,000/5,000/10,000 rendered blocks, 132/500/1,000 catalog entries, 1,000/10,000 vault files, representative structured CSS compilation, and A4/Letter/custom pagination math. The controller suite retains deterministic happy-dom fixtures with 100/1,000/5,000/10,000 mixed blocks, 100 data-free images, paged and pageless modes, and 1/3/10 leaves.

The separate full-renderer suite instantiates `PageRenderer` with its real compiler, page layout, Reading whitespace, and fixed `BaselineGridController`. Its standard named scenarios cover one/three/ten leaves, same-file and different-file ownership, one-leaf preview, A4/Letter pages, 100 images, and mixed tables/callouts/code/Mermaid-like/embed-like descendants. Run both renderer suites with `npm run bench:renderer`.

The baseline-controller suite also has a mixed 10,000-block case and opt-in 5,000/10,000 stress runs. The full-renderer 5,000-block Letter and 10,000-block custom-page cases remain opt-in because happy-dom allocation makes them unsuitable for every local check. Run `npm run bench:baseline:stress` and `npm run bench:stress` before changing renderer ownership, layout, or large-note behavior; record the host and runtime details with their output.

Vitest reports operations per second and latency for each fixture. These are informational comparison data, not CI timing gates: absolute milliseconds vary with hardware and runner load. Record the output with the Node, Obsidian, and device/browser versions when comparing changes.

Coverage reporting is separate:

```bash
npm run test:coverage
```

The report includes lines, statements, functions, and branches without claiming that a pure unit test substitutes for an Obsidian or physical-device check.

The alignment-specific command is `npm run bench:baseline`; `npm run bench:baseline:stress` includes the 5,000- and 10,000-block mixed cases. The controller benchmark measures one fixed-lattice full scan and teardown, so it does not include scroll rescans or child-derived origin work.

Timings, operation rate, and allocation-sensitive behavior are informational trend evidence. Structural renderer cleanup assertions are CI gates: owned styles, Templar classes/properties, preview state, observers, and scheduled animation frames must be released on teardown. Heap measurements remain a manual diagnostic because a repeatable heap harness would require duplicating Obsidian runtime shims outside Vitest. The production convergence guard records non-converged owners in the diagnostic report; a non-empty list is a correctness failure even when a benchmark completes.
