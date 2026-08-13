import { Window as HappyWindow } from 'happy-dom';

export interface ObserverHarness {
  window: Window;
  resizeInstances: Array<{ disconnects: number; observes: Element[] }>;
  mutationInstances: Array<{ disconnects: number; observes: Element[] }>;
  pendingAnimationFrames: Set<number>;
}

export function createObserverHarness(): ObserverHarness {
  // happy-dom intentionally exposes a separate set of DOM types. The harness
  // casts only at this boundary so production code continues to use the
  // browser/Obsidian DOM contracts while the tests can create distinct realms.
  const window = new HappyWindow() as unknown as Window;
  const resizeInstances: ObserverHarness['resizeInstances'] = [];
  const mutationInstances: ObserverHarness['mutationInstances'] = [];
  const pendingAnimationFrames = new Set<number>();
  const frameTimers = new Map<number, number>();
  let nextAnimationFrame = 1;

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
  Object.defineProperty(window, 'requestAnimationFrame', {
    configurable: true,
    value: (callback: FrameRequestCallback): number => {
      const frame = nextAnimationFrame;
      nextAnimationFrame += 1;
      pendingAnimationFrames.add(frame);
      const timer = window.setTimeout(() => {
        frameTimers.delete(frame);
        if (!pendingAnimationFrames.delete(frame)) return;
        callback(Date.now());
      }, 0);
      frameTimers.set(frame, timer);
      return frame;
    },
  });
  Object.defineProperty(window, 'cancelAnimationFrame', {
    configurable: true,
    value: (frame: number): void => {
      pendingAnimationFrames.delete(frame);
      const timer = frameTimers.get(frame);
      if (timer !== undefined) window.clearTimeout(timer);
      frameTimers.delete(frame);
    },
  });
  return { window, resizeInstances, mutationInstances, pendingAnimationFrames };
}
