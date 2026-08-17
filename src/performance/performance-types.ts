/**
 * Profile instrumentation is deliberately compile-time gated. The declaration
 * is consumed by esbuild in profile/release builds and is safely absent when
 * source files are evaluated by ordinary test tooling.
 */
declare const __TEMPLAR_PERF__: boolean;
declare const __TEMPLAR_PERF_SOURCE_COMMIT__: string;
declare const __TEMPLAR_PERF_INSTRUMENTATION_COMMIT__: string;

export const TEMPLAR_PERF_ENABLED =
  typeof __TEMPLAR_PERF__ !== 'undefined' && __TEMPLAR_PERF__;

export const PERF_SOURCE_COMMIT =
  typeof __TEMPLAR_PERF_SOURCE_COMMIT__ !== 'undefined'
    ? __TEMPLAR_PERF_SOURCE_COMMIT__
    : 'unknown';

export const PERF_INSTRUMENTATION_COMMIT =
  typeof __TEMPLAR_PERF_INSTRUMENTATION_COMMIT__ !== 'undefined'
    ? __TEMPLAR_PERF_INSTRUMENTATION_COMMIT__
    : 'unknown';

export const PERF_SAMPLE_LIMIT = 10_000;
export const PERF_EVENT_LIMIT = 5_000;

export interface PerfFeatureMask {
  pageLayout: boolean;
  readingWhitespace: boolean;
  paperOrigin: boolean;
  variableRhythm: boolean;
  imageSnap: boolean;
}

export const DEFAULT_PERF_FEATURE_MASK: PerfFeatureMask = {
  pageLayout: true,
  readingWhitespace: true,
  paperOrigin: true,
  variableRhythm: true,
  imageSnap: true,
};

export type PerfDimensionValue = string | number | boolean | null;
export type PerfDimensions = Record<string, PerfDimensionValue>;

export interface DurationAggregate {
  count: number;
  totalMs: number;
  meanMs: number;
  minMs: number | null;
  p50Ms: number | null;
  p75Ms: number | null;
  p90Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  stddevMs: number | null;
  retainedSampleCount: number;
  droppedSamples: number;
  samplesMs: number[];
}

export interface CounterAggregate {
  count: number;
  total: number;
  byDimensions: Record<string, number>;
}

export interface GaugeAggregate {
  value: number | null;
  samples: number[];
  droppedSamples: number;
}

export interface PerfEventRecord {
  name: string;
  atMs: number;
  dimensions: PerfDimensions;
}

export interface MemoryReading {
  supported: boolean;
  usedJSHeapSize: number | null;
  totalJSHeapSize: number | null;
  jsHeapSizeLimit: number | null;
}

export interface FrameGapTelemetry {
  label: 'RAF frame-gap telemetry';
  supported: boolean;
  sampleCount: number;
  meanMs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  p99Ms: number | null;
  maxMs: number | null;
  over16_7ms: number;
  over33_3ms: number;
  over50ms: number;
  over100ms: number;
  retainedSampleCount: number;
  droppedSamples: number;
  samplesMs: number[];
}

export interface LongTaskTelemetry {
  supported: boolean;
  count: number;
  totalMs: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
  retainedSampleCount: number;
  droppedSamples: number;
  samplesMs: number[];
}

export interface PerfStateSnapshots {
  start: Record<string, number>;
  end: Record<string, number>;
  afterCleanup: Record<string, number>;
}

export interface PerfScenarioMetadata {
  platform?: 'desktop' | 'android' | 'ios' | 'cli' | 'unknown';
  environmentId?: string;
  fixtureId?: string;
  styleProfile?: string;
  leafCount?: number;
  mode?: string;
  readingEnabled?: boolean;
  livePreviewEnabled?: boolean;
  previewActive?: boolean;
  notes?: string[];
}

export interface PerformanceCapture {
  schemaVersion: 1;
  profileInstrumentation: true;
  scenarioId: string;
  valid: boolean;
  invalidReason: string | null;
  sourceCommit: string;
  instrumentationCommit: string;
  pluginVersion: string;
  environmentId: string;
  platform: PerfScenarioMetadata['platform'];
  fixtureId: string | null;
  styleProfile: string | null;
  leafCount: number | null;
  mode: string | null;
  readingEnabled: boolean | null;
  livePreviewEnabled: boolean | null;
  previewActive: boolean | null;
  featureMask: PerfFeatureMask;
  durationMs: number;
  timing: {
    warmupStartMs: number | null;
    measurementStartMs: number;
    interactionStartMs: number | null;
    interactionEndMs: number | null;
    settleEndMs: number | null;
    measurementEndMs: number | null;
  };
  settled: boolean | null;
  terminatedEarly: boolean;
  terminationReason: string | null;
  frameMonitorSupported: boolean;
  longTaskSupport: boolean;
  memorySupport: boolean;
  counters: Record<string, CounterAggregate>;
  gauges: Record<string, GaugeAggregate>;
  durations: Record<string, DurationAggregate>;
  events: PerfEventRecord[];
  droppedEvents: number;
  frameGaps: FrameGapTelemetry;
  longTasks: LongTaskTelemetry;
  memory: {
    start: MemoryReading | null;
    end: MemoryReading | null;
  };
  stateSnapshots: PerfStateSnapshots;
  thermal: null;
  notes: string[];
}
