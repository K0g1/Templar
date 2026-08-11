# Performance fixtures

The repository contains a repeatable benchmark suite for the high-risk paths identified in the audit. It is intentionally informational while the integration suite settles; it does not impose an arbitrary global threshold.

Run it with:

```bash
npm run bench
```

The fixtures cover 100/1,000/5,000/10,000 rendered blocks, 132/500/1,000 catalog entries, 1,000/10,000 vault files, representative structured CSS compilation, and A4/Letter/custom pagination math. Vitest reports operations per second and latency for each fixture. Record the output with the Node, Obsidian, and device/browser versions when comparing changes.

Coverage reporting is separate:

```bash
npm run test:coverage
```

The report includes lines, statements, functions, and branches without claiming that a pure unit test substitutes for an Obsidian or physical-device check.
