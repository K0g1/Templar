import { Window as HappyWindow } from 'happy-dom';

export interface ObserverHarness {
  window: Window;
  resizeInstances: Array<{ disconnects: number; observes: Element[] }>;
  mutationInstances: Array<{ disconnects: number; observes: Element[] }>;
}

export function createObserverHarness(): ObserverHarness {
  // happy-dom intentionally exposes a separate set of DOM types. The harness
  // casts only at this boundary so production code continues to use the
  // browser/Obsidian DOM contracts while the tests can create distinct realms.
  const window = new HappyWindow() as unknown as Window;
  const resizeInstances: ObserverHarness['resizeInstances'] = [];
  const mutationInstances: ObserverHarness['mutationInstances'] = [];

  class RealmResizeObserver {
    private readonly record = { disconnects: 0, observes: [] as Element[] };

    public constructor(_callback: ResizeObserverCallback) {
      resizeInstances.push(this.record);
    }

    public observe(element: Element): void {
      this.record.observes.push(element);
    }

    public unobserve(_element: Element): void {}

    public disconnect(): void {
      this.record.disconnects += 1;
    }
  }

  class RealmMutationObserver {
    private readonly record = { disconnects: 0, observes: [] as Element[] };

    public constructor(_callback: MutationCallback) {
      mutationInstances.push(this.record);
    }

    public observe(element: Element, _options: MutationObserverInit): void {
      this.record.observes.push(element);
    }

    public disconnect(): void {
      this.record.disconnects += 1;
    }

    public takeRecords(): MutationRecord[] {
      return [];
    }
  }

  Object.defineProperty(window, 'ResizeObserver', { configurable: true, value: RealmResizeObserver });
  Object.defineProperty(window, 'MutationObserver', { configurable: true, value: RealmMutationObserver });
  return { window, resizeInstances, mutationInstances };
}
