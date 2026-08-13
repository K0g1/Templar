import {
  DEFAULT_PERF_FEATURE_MASK,
  PERF_EVENT_LIMIT,
  PERF_INSTRUMENTATION_COMMIT,
  PERF_SAMPLE_LIMIT,
  PERF_SOURCE_COMMIT,
  TEMPLAR_PERF_ENABLED,
  type CounterAggregate,
  type DurationAggregate,
  type FrameGapTelemetry,
  type GaugeAggregate,
  type LongTaskTelemetry,
  type MemoryReading,
  type PerfDimensions,
  type PerfEventRecord,
  type PerfFeatureMask,
  type PerfScenarioMetadata,
  type PerformanceCapture,
} from './performance-types';

interface DurationStore {
  count: number;
  totalMs: number;
  sumSquares: number;
  minMs: number | null;
  maxMs: number | null;
  samplesMs: number[];
  droppedSamples: number;
}

interface GaugeStore {
  value: number | null;
  samples: number[];
  droppedSamples: number;
}

interface ScenarioOptions {
  scenarioId: string;
  pluginVersion?: string;
  environmentId?: string;
  metadata?: PerfScenarioMetadata;
  featureMask?: Partial<PerfFeatureMask>;
  ownerWindow?: Window | null;
  settled?: boolean | null;
}

interface StopOptions {
  valid?: boolean;
  invalidReason?: string | null;
  settled?: boolean | null;
  terminatedEarly?: boolean;
  terminationReason?: string | null;
  notes?: string[];
}

interface PerformanceMemoryLike {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
  jsHeapSizeLimit: number;
}

interface PerformanceWithMemory extends Performance {
  memory?: PerformanceMemoryLike;
}

const emptyStateSnapshots = (): PerformanceCapture['stateSnapshots'] => ({
  start: {},
  end: {},
  afterCleanup: {},
});

function cloneDimensions(dimensions: PerfDimensions | undefined): PerfDimensions {
  if (!dimensions) return {};
  const result: PerfDimensions = {};
  for (const [key, value] of Object.entries(dimensions)) {
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      result[key] = value;
    }
  }
  return result;
}

function dimensionsKey(dimensions: PerfDimensions): string {
  return Object.keys(dimensions)
    .sort()
    .map((key) => `${key}=${JSON.stringify(dimensions[key])}`)
    .join('&');
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function percentile(samples: readonly number[], fraction: number): number | null {
  if (samples.length === 0) return null;
  const sorted = [...samples].sort((left, right) => left - right);
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const lowerValue = sorted[lower] ?? sorted[sorted.length - 1]!;
  const upperValue = sorted[upper] ?? lowerValue;
  return lowerValue + (upperValue - lowerValue) * (position - lower);
}

function standardDeviation(store: DurationStore): number | null {
  if (store.count === 0) return null;
  const mean = store.totalMs / store.count;
  return Math.sqrt(Math.max(0, store.sumSquares / store.count - mean * mean));
}

function aggregate(store: DurationStore): DurationAggregate {
  return {
    count: store.count,
    totalMs: store.totalMs,
    meanMs: store.count > 0 ? store.totalMs / store.count : 0,
    minMs: store.minMs,
    p50Ms: percentile(store.samplesMs, 0.5),
    p75Ms: percentile(store.samplesMs, 0.75),
    p90Ms: percentile(store.samplesMs, 0.9),
    p95Ms: percentile(store.samplesMs, 0.95),
    p99Ms: percentile(store.samplesMs, 0.99),
    maxMs: store.maxMs,
    stddevMs: standardDeviation(store),
    retainedSampleCount: store.samplesMs.length,
    droppedSamples: store.droppedSamples,
    samplesMs: [...store.samplesMs],
  };
}

function emptyDurationStore(): DurationStore {
  return {
    count: 0,
    totalMs: 0,
    sumSquares: 0,
    minMs: null,
    maxMs: null,
    samplesMs: [],
    droppedSamples: 0,
  };
}

function emptyGaugeStore(): GaugeStore {
  return { value: null, samples: [], droppedSamples: 0 };
}

function emptyFrameGaps(supported: boolean): FrameGapTelemetry {
  return {
    label: 'RAF frame-gap telemetry',
    supported,
    sampleCount: 0,
    meanMs: null,
    p50Ms: null,
    p95Ms: null,
    p99Ms: null,
    maxMs: null,
    over16_7ms: 0,
    over33_3ms: 0,
    over50ms: 0,
    over100ms: 0,
    retainedSampleCount: 0,
    droppedSamples: 0,
    samplesMs: [],
  };
}

function emptyLongTasks(supported: boolean): LongTaskTelemetry {
  return {
    supported,
    count: 0,
    totalMs: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
    retainedSampleCount: 0,
    droppedSamples: 0,
    samplesMs: [],
  };
}

function readMemory(): MemoryReading {
  const memory = typeof performance !== 'undefined'
    ? (performance as PerformanceWithMemory).memory
    : undefined;
  if (!memory) {
    return {
      supported: false,
      usedJSHeapSize: null,
      totalJSHeapSize: null,
      jsHeapSizeLimit: null,
    };
  }
  return {
    supported: true,
    usedJSHeapSize: finite(memory.usedJSHeapSize),
    totalJSHeapSize: finite(memory.totalJSHeapSize),
    jsHeapSizeLimit: finite(memory.jsHeapSizeLimit),
  };
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function relativeNote(note: string): string {
  return note.length > 500 ? note.slice(0, 500) : note;
}

/**
 * Bounded profile-only telemetry. The class is instantiated in normal builds
 * so callers do not need conditional plumbing, but every operation is a
 * compile-time-disabled no-op when __TEMPLAR_PERF__ is false.
 */
export class PerformanceMonitor {
  private readonly enabled: boolean;
  private readonly counters = new Map<string, CounterAggregate>();
  private readonly gauges = new Map<string, GaugeStore>();
  private readonly durations = new Map<string, DurationStore>();
  private readonly events: PerfEventRecord[] = [];
  private droppedEvents = 0;
  private scenario: PerformanceCapture | null = null;
  private scenarioStart = 0;
  private latestCapture: PerformanceCapture | null = null;
  private stateProvider: (() => Record<string, number>) | null = null;
  private featureMask: PerfFeatureMask = { ...DEFAULT_PERF_FEATURE_MASK };
  private frameWindow: Window | null = null;
  private frameHandle: number | null = null;
  private previousFrameAt: number | null = null;
  private readonly frameStore = emptyDurationStore();
  private frameSupported = false;
  private longTaskObserver: PerformanceObserver | null = null;
  private longTaskSupported = false;
  private readonly longTaskStore = emptyDurationStore();
  private memoryStart: MemoryReading | null = null;
  private memoryEnd: MemoryReading | null = null;

  public constructor(options: { enabled?: boolean } = {}) {
    this.enabled = TEMPLAR_PERF_ENABLED && options.enabled !== false;
  }

  public setStateProvider(provider: (() => Record<string, number>) | null): void {
    this.stateProvider = provider;
  }

  public setFeatureMask(mask: Partial<PerfFeatureMask>): PerfFeatureMask {
    this.featureMask = {
      ...this.featureMask,
      ...mask,
    };
    return { ...this.featureMask };
  }

  public getFeatureMask(): PerfFeatureMask {
    return { ...this.featureMask };
  }

  public counter(name: string, amount = 1, dimensions?: PerfDimensions): void {
    if (!this.enabled || !this.scenario) return;
    const current = this.counters.get(name) ?? {
      count: 0,
      total: 0,
      byDimensions: {},
    };
    current.count += 1;
    current.total += finite(amount);
    const key = dimensionsKey(cloneDimensions(dimensions));
    current.byDimensions[key] = (current.byDimensions[key] ?? 0) + finite(amount);
    this.counters.set(name, current);
  }

  public gauge(name: string, value: number | null): void {
    if (!this.enabled || !this.scenario) return;
    const current = this.gauges.get(name) ?? emptyGaugeStore();
    current.value = value === null || !Number.isFinite(value) ? null : value;
    if (current.value !== null) {
      if (current.samples.length < PERF_SAMPLE_LIMIT) current.samples.push(current.value);
      else current.droppedSamples += 1;
    }
    this.gauges.set(name, current);
  }

  public event(name: string, dimensions?: PerfDimensions): void {
    if (!this.enabled || !this.scenario) return;
    if (this.events.length >= PERF_EVENT_LIMIT) {
      this.droppedEvents += 1;
      return;
    }
    this.events.push({
      name,
      atMs: Math.max(0, now() - this.scenarioStart),
      dimensions: cloneDimensions(dimensions),
    });
  }

  public measureSync<T>(name: string, operation: () => T, dimensions?: PerfDimensions): T {
    if (!this.enabled || !this.scenario) return operation();
    const started = now();
    try {
      return operation();
    } finally {
      this.recordDuration(name, now() - started, dimensions);
    }
  }

  public async measureAsync<T>(name: string, operation: () => Promise<T>, dimensions?: PerfDimensions): Promise<T> {
    if (!this.enabled || !this.scenario) return operation();
    const started = now();
    try {
      return await operation();
    } finally {
      this.recordDuration(name, now() - started, dimensions);
    }
  }

  public startScenario(options: ScenarioOptions): void {
    if (!this.enabled) return;
    this.resetMetrics();
    this.scenarioStart = now();
    const metadata = options.metadata ?? {};
    this.featureMask = {
      ...DEFAULT_PERF_FEATURE_MASK,
      ...this.featureMask,
      ...options.featureMask,
    };
    const started = this.scenarioStart;
    this.scenario = {
      schemaVersion: 1,
      profileInstrumentation: true,
      scenarioId: relativeNote(options.scenarioId || 'manual'),
      valid: true,
      invalidReason: null,
      sourceCommit: PERF_SOURCE_COMMIT,
      instrumentationCommit: PERF_INSTRUMENTATION_COMMIT,
      pluginVersion: options.pluginVersion ?? 'unknown',
      environmentId: metadata.environmentId ?? options.environmentId ?? 'unknown',
      platform: metadata.platform ?? 'unknown',
      fixtureId: metadata.fixtureId ?? null,
      styleProfile: metadata.styleProfile ?? null,
      leafCount: metadata.leafCount ?? null,
      mode: metadata.mode ?? null,
      readingEnabled: metadata.readingEnabled ?? null,
      livePreviewEnabled: metadata.livePreviewEnabled ?? null,
      previewActive: metadata.previewActive ?? null,
      featureMask: { ...this.featureMask },
      durationMs: 0,
      timing: {
        warmupStartMs: null,
        measurementStartMs: started,
        interactionStartMs: null,
        interactionEndMs: null,
        settleEndMs: null,
        measurementEndMs: null,
      },
      settled: options.settled ?? null,
      terminatedEarly: false,
      terminationReason: null,
      frameMonitorSupported: false,
      longTaskSupport: false,
      memorySupport: false,
      counters: {},
      gauges: {},
      durations: {},
      events: [],
      droppedEvents: 0,
      frameGaps: emptyFrameGaps(false),
      longTasks: emptyLongTasks(false),
      memory: { start: null, end: null },
      stateSnapshots: emptyStateSnapshots(),
      thermal: null,
      notes: [],
    };
    this.memoryStart = readMemory();
    this.scenario.memory.start = this.memoryStart;
    this.scenario.memorySupport = this.memoryStart.supported;
    this.snapshot('start');
    this.startFrameMonitor(options.ownerWindow ?? this.defaultWindow());
    this.startLongTaskMonitor();
    this.event('scenario.start', { scenarioId: this.scenario.scenarioId });
  }

  public stopScenario(options: StopOptions = {}): PerformanceCapture | null {
    if (!this.enabled || !this.scenario) return this.latestCapture;
    this.scenario.timing.measurementEndMs = now();
    this.scenario.durationMs = Math.max(0, this.scenario.timing.measurementEndMs - this.scenario.timing.measurementStartMs);
    this.scenario.valid = options.valid ?? true;
    this.scenario.invalidReason = options.invalidReason ?? null;
    if (options.settled !== undefined) this.scenario.settled = options.settled;
    this.scenario.terminatedEarly = options.terminatedEarly ?? false;
    this.scenario.terminationReason = options.terminationReason ?? null;
    this.scenario.notes = [...(options.notes ?? [])].map(relativeNote);
    this.stopFrameMonitor();
    this.stopLongTaskMonitor();
    this.memoryEnd = readMemory();
    this.scenario.memory.end = this.memoryEnd;
    this.scenario.memorySupport =
      Boolean(this.scenario.memory.start?.supported || this.memoryEnd.supported);
    this.scenario.frameMonitorSupported = this.frameSupported;
    this.scenario.longTaskSupport = this.longTaskSupported;
    this.scenario.frameGaps = this.frameAggregate();
    this.scenario.longTasks = this.longTaskAggregate();
    this.scenario.timing.measurementEndMs = now();
    this.scenario.durationMs = Math.max(0, this.scenario.timing.measurementEndMs - this.scenario.timing.measurementStartMs);
    this.snapshot('end');
    this.flushMetrics();
    this.event('scenario.stop', { scenarioId: this.scenario.scenarioId });
    this.flushMetrics();
    this.latestCapture = this.cloneCapture(this.scenario);
    this.scenario = null;
    return this.cloneCapture(this.latestCapture);
  }

  public reset(): void {
    if (!this.enabled) return;
    this.stopFrameMonitor();
    this.stopLongTaskMonitor();
    this.resetMetrics();
    this.scenario = null;
    this.latestCapture = null;
    this.memoryStart = null;
    this.memoryEnd = null;
  }

  public snapshot(label?: 'start' | 'end' | 'afterCleanup'): PerformanceCapture | null {
    if (!this.enabled) return null;
    const current = this.scenario ?? this.latestCapture;
    if (!current) return null;
    if (label && this.stateProvider) {
      current.stateSnapshots[label] = {
        ...this.stateProvider(),
      };
    }
    this.flushMetrics(current);
    return this.cloneCapture(current);
  }

  public mark(name: 'warmupStart' | 'interactionStart' | 'interactionEnd' | 'settleEnd'): void {
    if (!this.enabled || !this.scenario) return;
    const timestamp = now();
    if (name === 'warmupStart') this.scenario.timing.warmupStartMs = timestamp;
    if (name === 'interactionStart') this.scenario.timing.interactionStartMs = timestamp;
    if (name === 'interactionEnd') this.scenario.timing.interactionEndMs = timestamp;
    if (name === 'settleEnd') this.scenario.timing.settleEndMs = timestamp;
    this.event(`scenario.${name}`);
  }

  public latest(): PerformanceCapture | null {
    return this.latestCapture ? this.cloneCapture(this.latestCapture) : null;
  }

  public isActive(): boolean {
    return this.scenario !== null;
  }

  private recordDuration(name: string, value: number, dimensions?: PerfDimensions): void {
    if (!this.enabled || !this.scenario) return;
    const duration = Math.max(0, finite(value));
    const current = this.durations.get(name) ?? emptyDurationStore();
    current.count += 1;
    current.totalMs += duration;
    current.sumSquares += duration * duration;
    current.minMs = current.minMs === null ? duration : Math.min(current.minMs, duration);
    current.maxMs = current.maxMs === null ? duration : Math.max(current.maxMs, duration);
    if (current.samplesMs.length < PERF_SAMPLE_LIMIT) current.samplesMs.push(duration);
    else current.droppedSamples += 1;
    this.durations.set(name, current);
  }

  private resetMetrics(): void {
    this.counters.clear();
    this.gauges.clear();
    this.durations.clear();
    this.events.length = 0;
    this.droppedEvents = 0;
    this.frameStore.count = 0;
    this.frameStore.totalMs = 0;
    this.frameStore.sumSquares = 0;
    this.frameStore.minMs = null;
    this.frameStore.maxMs = null;
    this.frameStore.samplesMs.length = 0;
    this.frameStore.droppedSamples = 0;
    this.longTaskStore.count = 0;
    this.longTaskStore.totalMs = 0;
    this.longTaskStore.sumSquares = 0;
    this.longTaskStore.minMs = null;
    this.longTaskStore.maxMs = null;
    this.longTaskStore.samplesMs.length = 0;
    this.longTaskStore.droppedSamples = 0;
    this.frameSupported = false;
    this.longTaskSupported = false;
  }

  private startFrameMonitor(view: Window | null): void {
    this.frameWindow = view;
    if (!view?.requestAnimationFrame) return;
    this.frameSupported = true;
    this.previousFrameAt = null;
    const tick = (timestamp: number): void => {
      if (!this.scenario || this.frameWindow !== view) return;
      if (this.previousFrameAt !== null) {
        this.recordFrameGap(timestamp - this.previousFrameAt);
      }
      this.previousFrameAt = timestamp;
      this.frameHandle = view.requestAnimationFrame(tick);
    };
    this.frameHandle = view.requestAnimationFrame(tick);
  }

  private stopFrameMonitor(): void {
    if (this.frameWindow && this.frameHandle !== null) {
      this.frameWindow.cancelAnimationFrame(this.frameHandle);
    }
    this.frameWindow = null;
    this.frameHandle = null;
    this.previousFrameAt = null;
  }

  private recordFrameGap(value: number): void {
    if (!this.enabled || !this.scenario) return;
    const gap = Math.max(0, finite(value));
    this.frameStore.count += 1;
    this.frameStore.totalMs += gap;
    this.frameStore.sumSquares += gap * gap;
    this.frameStore.minMs = this.frameStore.minMs === null ? gap : Math.min(this.frameStore.minMs, gap);
    this.frameStore.maxMs = this.frameStore.maxMs === null ? gap : Math.max(this.frameStore.maxMs, gap);
    if (this.frameStore.samplesMs.length < PERF_SAMPLE_LIMIT) this.frameStore.samplesMs.push(gap);
    else this.frameStore.droppedSamples += 1;
  }

  private frameAggregate(): FrameGapTelemetry {
    const store = this.frameStore;
    return {
      label: 'RAF frame-gap telemetry',
      supported: this.frameSupported,
      sampleCount: store.count,
      meanMs: store.count > 0 ? store.totalMs / store.count : null,
      p50Ms: percentile(store.samplesMs, 0.5),
      p95Ms: percentile(store.samplesMs, 0.95),
      p99Ms: percentile(store.samplesMs, 0.99),
      maxMs: store.maxMs,
      over16_7ms: store.samplesMs.filter((value) => value > 16.7).length,
      over33_3ms: store.samplesMs.filter((value) => value > 33.3).length,
      over50ms: store.samplesMs.filter((value) => value > 50).length,
      over100ms: store.samplesMs.filter((value) => value > 100).length,
      retainedSampleCount: store.samplesMs.length,
      droppedSamples: store.droppedSamples,
      samplesMs: [...store.samplesMs],
    };
  }

  private startLongTaskMonitor(): void {
    const Constructor = typeof PerformanceObserver !== 'undefined' ? PerformanceObserver : undefined;
    if (!Constructor) return;
    try {
      this.longTaskObserver = new Constructor((list) => {
        for (const entry of list.getEntries()) {
          this.recordLongTask(entry.duration);
        }
      });
      this.longTaskObserver.observe({ type: 'longtask', buffered: false });
      this.longTaskSupported = true;
    } catch {
      this.longTaskObserver?.disconnect();
      this.longTaskObserver = null;
      this.longTaskSupported = false;
    }
  }

  private stopLongTaskMonitor(): void {
    this.longTaskObserver?.disconnect();
    this.longTaskObserver = null;
  }

  private recordLongTask(value: number): void {
    const duration = Math.max(0, finite(value));
    const store = this.longTaskStore;
    store.count += 1;
    store.totalMs += duration;
    store.sumSquares += duration * duration;
    store.minMs = store.minMs === null ? duration : Math.min(store.minMs, duration);
    store.maxMs = store.maxMs === null ? duration : Math.max(store.maxMs, duration);
    if (store.samplesMs.length < PERF_SAMPLE_LIMIT) store.samplesMs.push(duration);
    else store.droppedSamples += 1;
  }

  private longTaskAggregate(): LongTaskTelemetry {
    const store = this.longTaskStore;
    return {
      supported: this.longTaskSupported,
      count: store.count,
      totalMs: store.totalMs,
      p50Ms: percentile(store.samplesMs, 0.5),
      p95Ms: percentile(store.samplesMs, 0.95),
      maxMs: store.maxMs,
      retainedSampleCount: store.samplesMs.length,
      droppedSamples: store.droppedSamples,
      samplesMs: [...store.samplesMs],
    };
  }

  private defaultWindow(): Window | null {
    return typeof window !== 'undefined' ? window : null;
  }

  private flushMetrics(target = this.scenario): void {
    if (!target) return;
    const counters: Record<string, CounterAggregate> = {};
    for (const [name, value] of this.counters) {
      counters[name] = {
        count: value.count,
        total: value.total,
        byDimensions: { ...value.byDimensions },
      };
    }
    const gauges: Record<string, GaugeAggregate> = {};
    for (const [name, value] of this.gauges) {
      gauges[name] = {
        value: value.value,
        samples: [...value.samples],
        droppedSamples: value.droppedSamples,
      };
    }
    const durations: Record<string, DurationAggregate> = {};
    for (const [name, value] of this.durations) durations[name] = aggregate(value);
    target.counters = counters;
    target.gauges = gauges;
    target.durations = durations;
    target.events = this.events.map((event) => ({
      name: event.name,
      atMs: event.atMs,
      dimensions: { ...event.dimensions },
    }));
    target.droppedEvents = this.droppedEvents;
    target.frameGaps = this.frameAggregate();
    target.longTasks = this.longTaskAggregate();
  }

  private cloneCapture(capture: PerformanceCapture): PerformanceCapture {
    return JSON.parse(JSON.stringify(capture)) as PerformanceCapture;
  }
}

export type { ScenarioOptions, StopOptions };
