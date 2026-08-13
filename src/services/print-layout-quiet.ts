import { realmFor, type DomRealm } from './dom-realm';

/** Wait for the target leaf's layout to be quiet using that leaf's DOM realm. */
export async function waitForLayoutQuiet(target: HTMLElement, targetWindow: Window): Promise<void> {
  let realm: DomRealm | null = null;
  try {
    realm = realmFor(target);
  } catch {
    // The target may be detached during a mode transition; timers still give
    // the print pipeline a bounded wait without borrowing global observers.
  }
  const window = realm?.window ?? targetWindow;
  await new Promise<void>((resolve) => {
    let quietTimer = 0;
    let maximumTimer = 0;
    let complete = false;
    const finish = (): void => {
      if (complete) return;
      complete = true;
      if (quietTimer) window.clearTimeout(quietTimer);
      if (maximumTimer) window.clearTimeout(maximumTimer);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
      resolve();
    };
    const changed = (): void => {
      if (quietTimer) window.clearTimeout(quietTimer);
      quietTimer = window.setTimeout(finish, 120);
    };
    const resizeObserver = realm?.ResizeObserver
      ? new realm.ResizeObserver(changed)
      : null;
    const mutationObserver = realm?.MutationObserver
      ? new realm.MutationObserver(changed)
      : null;
    resizeObserver?.observe(target);
    mutationObserver?.observe(target, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    maximumTimer = window.setTimeout(finish, 3000);
    changed();
  });
  await new Promise<void>((resolve) =>
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => resolve())),
  );
}
