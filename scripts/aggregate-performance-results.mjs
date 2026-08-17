import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

const rootArg = process.argv.find((arg) => arg.startsWith('--root='));
const root = resolve(rootArg?.slice('--root='.length) ?? 'perf-results/b63adb76');
const rawRoot = join(root, 'raw');
const summaryRoot = join(root, 'summary');

async function filesIn(directory) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesIn(path));
    else if (entry.isFile() && entry.name.endsWith('.templar-perf.json')) files.push(path);
  }
  return files;
}

function csv(value) {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function csvFile(headers, rows) {
  return `${headers.join(',')}\n${rows.map((row) => headers.map((header) => csv(row[header])).join(',')).join('\n')}\n`;
}

function counterTotal(capture, name) {
  return capture.counters?.[name]?.total ?? null;
}

function durationTotal(capture, name) {
  return capture.durations?.[name]?.totalMs ?? null;
}

function durationP95(capture, name) {
  return capture.durations?.[name]?.p95Ms ?? null;
}

function statField(values, field) {
  return stats(values)?.[field] ?? null;
}

function scenarioBase(id) {
  return id.replace(/-run-\d+$/, '');
}

const rawFiles = await filesIn(rawRoot);
const captures = [];
for (const path of rawFiles) {
  try {
    const capture = JSON.parse(await readFile(path, 'utf8'));
    captures.push({ path, capture });
  } catch (error) {
    console.warn(`Skipping invalid capture ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

const allHeaders = [
  'scenario_id', 'run_number', 'valid', 'platform', 'environment_id', 'fixture_id',
  'style_profile', 'leaf_count', 'feature_mask', 'duration_ms', 'templar_total_measured_ms',
  'refresh_all_count', 'refresh_file_count', 'refresh_leaf_count', 'paginate_count',
  'reading_reconcile_count', 'mutation_callback_count', 'resize_callback_count',
  'templar_raf_count', 'frame_gap_p95_ms', 'frame_gap_max_ms', 'long_task_count',
  'long_task_total_ms', 'heap_start_bytes', 'heap_end_bytes', 'thermal_start', 'thermal_end',
  'battery_start_percent', 'battery_end_percent', 'notes',
];
const allRows = captures.map(({ path, capture }) => ({
  scenario_id: capture.scenarioId,
  run_number: capture.scenarioId.match(/-run-(\d+)$/)?.[1] ?? null,
  valid: capture.valid,
  platform: capture.platform ?? null,
  environment_id: capture.environmentId ?? null,
  fixture_id: capture.fixtureId ?? null,
  style_profile: capture.styleProfile ?? null,
  leaf_count: capture.leafCount ?? null,
  feature_mask: capture.featureMask ?? null,
  duration_ms: capture.durationMs ?? null,
  templar_total_measured_ms: durationTotal(capture, 'renderer.refreshLeaf.total'),
  refresh_all_count: counterTotal(capture, 'renderer.refreshAll.count'),
  refresh_file_count: counterTotal(capture, 'renderer.refreshFile.count'),
  refresh_leaf_count: counterTotal(capture, 'renderer.refreshLeaf.count'),
  paginate_count: counterTotal(capture, 'pageLayout.pagination.count'),
  reading_reconcile_count: counterTotal(capture, 'reading.reconcile.count'),
  mutation_callback_count: sumCounters(capture, [
    'pageLayout.mutationObserver.callback', 'imageSnap.mutationObserver.callback',
    'paperOrigin.mutationObserver.callback', 'rhythm.mutationObserver.callback',
  ]),
  resize_callback_count: sumCounters(capture, [
    'pageLayout.resizeObserver.callback', 'imageSnap.resizeObserver.callback',
    'paperOrigin.resizeObserver.callback', 'rhythm.resizeObserver.callback',
  ]),
  templar_raf_count: sumCounters(capture, [
    'pageLayout.raf.execute', 'reading.raf.execute', 'paperOrigin.raf.execute',
    'rhythm.raf.execute',
  ]),
  frame_gap_p95_ms: capture.frameGaps?.supported ? capture.frameGaps.p95Ms : null,
  frame_gap_max_ms: capture.frameGaps?.supported ? capture.frameGaps.maxMs : null,
  long_task_count: capture.longTaskSupport ? capture.longTasks?.count ?? null : null,
  long_task_total_ms: capture.longTaskSupport ? capture.longTasks?.totalMs ?? null : null,
  heap_start_bytes: capture.memorySupport ? capture.memory?.start?.usedJSHeapSize ?? null : null,
  heap_end_bytes: capture.memorySupport ? capture.memory?.end?.usedJSHeapSize ?? null : null,
  thermal_start: capture.thermal?.start ?? null,
  thermal_end: capture.thermal?.end ?? null,
  battery_start_percent: capture.thermal?.batteryStartPercent ?? null,
  battery_end_percent: capture.thermal?.batteryEndPercent ?? null,
  notes: [relative(root, path), ...(capture.notes ?? [])].join(' | '),
}));

function sumCounters(capture, names) {
  const values = names.map((name) => counterTotal(capture, name));
  if (values.some((value) => value === null)) return null;
  return values.reduce((total, value) => total + value, 0);
}

function stats(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);
  const percentile = (fraction) => {
    const position = (sorted.length - 1) * fraction;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const lowerValue = sorted[lower] ?? sorted[sorted.length - 1];
    const upperValue = sorted[upper] ?? lowerValue;
    return lowerValue + (upperValue - lowerValue) * (position - lower);
  };
  const total = values.reduce((sum, value) => sum + value, 0);
  const mean = total / values.length;
  return {
    count: values.length,
    total,
    mean,
    min: sorted[0],
    p50: percentile(0.5),
    p75: percentile(0.75),
    p90: percentile(0.9),
    p95: percentile(0.95),
    p99: percentile(0.99),
    max: sorted[sorted.length - 1],
    stddev: Math.sqrt(values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length),
  };
}

const grouped = new Map();
for (const { capture } of captures) {
  const key = scenarioBase(capture.scenarioId);
  const group = grouped.get(key) ?? [];
  group.push(capture);
  grouped.set(key, group);
}
const scenarioHeaders = [
  'scenario_id', 'runs', 'valid_runs', 'platform', 'environment_id', 'fixture_id',
  'style_profile', 'duration_p50_ms', 'duration_p95_ms', 'templar_p50_ms',
  'refresh_leaf_p50', 'page_layout_p95_ms', 'pagination_p95_ms', 'reading_reconcile_p95_ms',
  'frame_gap_p95_ms', 'frame_gap_max_ms', 'long_task_total_ms', 'all_cleanup_zero', 'notes',
];
const scenarioRows = [...grouped.entries()].map(([scenarioId, group]) => {
  const first = group[0];
  const frameValues = group.filter((capture) => capture.frameGaps?.supported).map((capture) => capture.frameGaps.p95Ms).filter((value) => typeof value === 'number');
  const frameMaxValues = group.filter((capture) => capture.frameGaps?.supported).map((capture) => capture.frameGaps.maxMs).filter((value) => typeof value === 'number');
  const cleanupValues = group.map((capture) => Object.values(capture.stateSnapshots?.afterCleanup ?? {}).every((value) => value === 0));
  return {
    scenario_id: scenarioId,
    runs: group.length,
    valid_runs: group.filter((capture) => capture.valid).length,
    platform: first?.platform ?? null,
    environment_id: first?.environmentId ?? null,
    fixture_id: first?.fixtureId ?? null,
    style_profile: first?.styleProfile ?? null,
    duration_p50_ms: statField(group.map((capture) => capture.durationMs), 'p50'),
    duration_p95_ms: statField(group.map((capture) => capture.durationMs), 'p95'),
    templar_p50_ms: statField(group.map((capture) => durationTotal(capture, 'renderer.refreshLeaf.total')).filter((value) => value !== null), 'p50'),
    refresh_leaf_p50: statField(group.map((capture) => counterTotal(capture, 'renderer.refreshLeaf.count')).filter((value) => value !== null), 'p50'),
    page_layout_p95_ms: statField(group.map((capture) => durationP95(capture, 'pageLayout.layout')).filter((value) => value !== null), 'p95'),
    pagination_p95_ms: statField(group.map((capture) => durationP95(capture, 'pageLayout.pagination')).filter((value) => value !== null), 'p95'),
    reading_reconcile_p95_ms: statField(group.map((capture) => durationP95(capture, 'reading.reconcile')).filter((value) => value !== null), 'p95'),
    frame_gap_p95_ms: statField(frameValues, 'p95'),
    frame_gap_max_ms: statField(frameMaxValues, 'max'),
    long_task_total_ms: group.some((capture) => !capture.longTaskSupport) ? null : statField(group.map((capture) => capture.longTasks.totalMs), 'p95'),
    all_cleanup_zero: cleanupValues.every(Boolean),
    notes: group.some((capture) => capture.valid === false) ? 'contains invalid run' : '',
  };
});

const metricValues = new Map();
for (const { capture } of captures) {
  for (const [metric, aggregate] of Object.entries(capture.durations ?? {})) {
    const values = metricValues.get(metric) ?? [];
    values.push(...(aggregate.samplesMs ?? []));
    metricValues.set(metric, values);
  }
}
const metricHeaders = ['metric', 'sample_count', 'total_ms', 'mean_ms', 'p50_ms', 'p75_ms', 'p90_ms', 'p95_ms', 'p99_ms', 'max_ms', 'stddev_ms', 'source_runs'];
const metricRows = [...metricValues.entries()].map(([metric, values]) => {
  const result = stats(values);
  return {
    metric,
    sample_count: result?.count ?? null,
    total_ms: result?.total ?? null,
    mean_ms: result?.mean ?? null,
    p50_ms: result?.p50 ?? null,
    p75_ms: result?.p75 ?? null,
    p90_ms: result?.p90 ?? null,
    p95_ms: result?.p95 ?? null,
    p99_ms: result?.p99 ?? null,
    max_ms: result?.max ?? null,
    stddev_ms: result?.stddev ?? null,
    source_runs: captures.filter(({ capture }) => capture.durations?.[metric]).length,
  };
});

const hotspotMetrics = [
  'renderer.refreshLeaf.total', 'pageLayout.layout', 'pageLayout.pagination',
  'reading.reconcile', 'paperOrigin.scan', 'rhythm.scan', 'imageSnap.scan',
  'font.measureWithDom', 'renderer.refreshLeaf.compileStyle',
];
const hotspotRows = hotspotMetrics.map((metric, index) => {
  const row = metricRows.find((candidate) => candidate.metric === metric);
  return {
    rank: index + 1,
    subsystem: metric.split('.')[0] ?? metric,
    scenario: 'synthetic profile matrix',
    metric,
    measured_value: row?.total_ms ?? null,
    comparison_value: null,
    delta_percent: null,
    confidence: row && row.source_runs >= 3 ? 'medium' : 'low',
    evidence_files: row ? 'raw/**/*.templar-perf.json' : '',
  };
}).filter((row) => row.measured_value !== null).sort((left, right) => right.measured_value - left.measured_value).map((row, index) => ({ ...row, rank: index + 1 }));

await mkdir(summaryRoot, { recursive: true });
await writeFile(join(summaryRoot, 'all-runs.csv'), csvFile(allHeaders, allRows));
await writeFile(join(summaryRoot, 'scenario-summary.csv'), csvFile(scenarioHeaders, scenarioRows));
await writeFile(join(summaryRoot, 'metric-summary.csv'), csvFile(metricHeaders, metricRows));
await writeFile(join(summaryRoot, 'hotspot-ranking.csv'), csvFile(['rank', 'subsystem', 'scenario', 'metric', 'measured_value', 'comparison_value', 'delta_percent', 'confidence', 'evidence_files'], hotspotRows));

const report = [
  '# Synthetic performance report',
  '',
  `Raw captures: ${String(captures.length)}. Each scenario was executed in separate process runs where available; unsupported host metrics remain null.`,
  '',
  '## Scenario summary',
  '',
  '| Scenario | Runs | Duration p50 (ms) | Templar p50 (ms) | RefreshLeaf p50 | Cleanup |',
  '| --- | ---: | ---: | ---: | ---: | --- |',
  ...scenarioRows.map((row) => `| ${row.scenario_id} | ${String(row.runs)} | ${format(row.duration_p50_ms)} | ${format(row.templar_p50_ms)} | ${format(row.refresh_leaf_p50)} | ${row.all_cleanup_zero ? 'yes' : 'no'} |`),
  '',
  '## Highest measured duration totals',
  '',
  '| Rank | Metric | P95 (ms) | Total retained sample time (ms) | Confidence |',
  '| ---: | --- | ---: | ---: | --- |',
  ...hotspotRows.slice(0, 10).map((row) => `| ${String(row.rank)} | ${row.metric} | ${format(metricRows.find((candidate) => candidate.metric === row.metric)?.p95_ms)} | ${format(row.measured_value)} | ${row.confidence} |`),
  '',
  'This report is attribution evidence only. It contains no optimization recommendation.',
  '',
].join('\n');
await writeFile(join(summaryRoot, 'performance-report.md'), report);
console.log(`Aggregated ${String(captures.length)} captures into ${summaryRoot}`);

function format(value) {
  return value === null || value === undefined ? 'unsupported' : Number(value).toFixed(3);
}
