import { describe, expect, it } from 'vitest';
import { PerformanceMonitor } from '../src/performance/performance-monitor';

describe('profile performance monitor', () => {
  it('is a no-op when explicitly disabled and never creates a capture', () => {
    const monitor = new PerformanceMonitor({ enabled: false });
    monitor.startScenario({ scenarioId: 'disabled' });
    monitor.counter('secret.note.contents');
    monitor.measureSync('secret.path', () => undefined);
    expect(monitor.stopScenario()).toBeNull();
    expect(monitor.latest()).toBeNull();
  });

  it('aggregates counters, durations, dimensions, gauges, and state snapshots', () => {
    const monitor = new PerformanceMonitor();
    monitor.setStateProvider(() => ({ 'PageRenderer.styledViews': 2 }));
    monitor.startScenario({
      scenarioId: 'aggregation',
      metadata: { platform: 'cli', environmentId: 'test' },
    });
    monitor.counter('renderer.refreshLeaf.count', 2, { reason: 'metadata-change' });
    monitor.counter('renderer.refreshLeaf.count', 1, { reason: 'metadata-change' });
    monitor.gauge('PageLayout.states', 3);
    monitor.measureSync('compilePageStyle', () => undefined);
    monitor.mark('interactionStart');
    monitor.mark('interactionEnd');
    const capture = monitor.stopScenario({ settled: true });

    expect(capture?.counters['renderer.refreshLeaf.count']?.total).toBe(3);
    expect(capture?.counters['renderer.refreshLeaf.count']?.byDimensions['reason="metadata-change"']).toBe(3);
    expect(capture?.durations.compilePageStyle?.count).toBe(1);
    expect(capture?.gauges['PageLayout.states']?.value).toBe(3);
    expect(capture?.stateSnapshots.start['PageRenderer.styledViews']).toBe(2);
    expect(capture?.timing.interactionStartMs).not.toBeNull();
    expect(capture?.frameGaps.supported).toBe(false);
    expect(typeof capture?.longTasks.supported).toBe('boolean');
    if (capture && !capture.longTasks.supported) expect(capture.longTasks.count).toBe(0);
  });

  it('keeps duration samples bounded and reports dropped samples', () => {
    const monitor = new PerformanceMonitor();
    monitor.startScenario({ scenarioId: 'bounded' });
    for (let index = 0; index < 10_050; index += 1) {
      monitor.measureSync('bounded.metric', () => undefined);
    }
    const capture = monitor.stopScenario();
    const metric = capture?.durations['bounded.metric'];
    expect(metric?.count).toBe(10_050);
    expect(metric?.retainedSampleCount).toBe(10_000);
    expect(metric?.droppedSamples).toBe(50);
    expect(capture?.events.length).toBeLessThanOrEqual(5_000);
  });

  it('returns defensive snapshots and does not export note contents or paths', () => {
    const monitor = new PerformanceMonitor();
    monitor.startScenario({
      scenarioId: 'privacy',
      metadata: { fixtureId: 'F002', notes: ['synthetic only'] },
    });
    const first = monitor.stopScenario();
    if (!first) throw new Error('Expected a capture.');
    first.scenarioId = 'mutated';
    first.events.push({ name: 'private/Notes/secret.md', atMs: 0, dimensions: {} });
    const second = monitor.latest();
    expect(second?.scenarioId).toBe('privacy');
    expect(JSON.stringify(second)).not.toContain('secret.md');
    expect(JSON.stringify(second)).not.toContain('private/Notes');
  });

  it('reset clears active and completed captures', () => {
    const monitor = new PerformanceMonitor();
    monitor.startScenario({ scenarioId: 'reset' });
    monitor.stopScenario();
    expect(monitor.latest()).not.toBeNull();
    monitor.reset();
    expect(monitor.latest()).toBeNull();
    expect(monitor.isActive()).toBe(false);
  });
});
