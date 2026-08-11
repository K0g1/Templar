import type { DomRealm } from './dom-realm';

/** Common cleanup contract for renderer-owned observer state machines. */
export interface ObserverController {
  readonly realm: DomRealm;
  clear(): void;
  destroy(): void;
}

export function disconnectObserver(
  observer: ResizeObserver | MutationObserver | null | undefined,
): void {
  observer?.disconnect();
}
