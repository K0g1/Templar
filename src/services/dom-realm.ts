export interface DomRealm {
  document: Document;
  window: Window;
  ResizeObserver: typeof ResizeObserver | null;
  MutationObserver: typeof MutationObserver | null;
}

type RealmWindow = Window & {
  ResizeObserver?: typeof ResizeObserver;
  MutationObserver?: typeof MutationObserver;
};

export function realmFor(element: Element): DomRealm {
  const document = element.ownerDocument;
  const window = document.defaultView;
  if (!window) {
    throw new Error('Templar could not find the DOM window that owns this element.');
  }
  const ownerWindow = window as RealmWindow;
  return {
    document,
    window,
    ResizeObserver: ownerWindow.ResizeObserver ?? null,
    MutationObserver: ownerWindow.MutationObserver ?? null,
  };
}
