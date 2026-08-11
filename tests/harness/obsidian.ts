export function fakeWorkspace() {
  return {
    getLeavesOfType: () => [],
    getActiveViewOfType: () => null,
  };
}

/** Install the small Obsidian DOM extension surface used by renderer tests. */
export function installObsidianDomExtensions(ownerWindow: Window): void {
  const prototype = Object.getPrototypeOf(
    ownerWindow.document.createElement('div'),
  ) as Record<string, unknown>;
  const elementConstructor = (ownerWindow as unknown as {
    HTMLElement?: { prototype?: Record<string, unknown> };
  }).HTMLElement;
  const prototypes = [prototype, elementConstructor?.prototype].filter(
    (value): value is Record<string, unknown> => value !== undefined,
  );
  for (const target of prototypes) {
    if (!target.addClass) {
      Object.defineProperties(target, {
        addClass: { value: function addClass(this: Element, ...classes: string[]) { this.classList.add(...classes); } },
        removeClass: { value: function removeClass(this: Element, ...classes: string[]) { this.classList.remove(...classes); } },
        hasClass: { value: function hasClass(this: Element, className: string) { return this.classList.contains(className); } },
        instanceOf: { value: function instanceOf(this: object, type: abstract new (...args: never[]) => object) { return this instanceof type; } },
      });
    }
    if (!target.setCssProps) {
      Object.defineProperty(target, 'setCssProps', {
        value: function setCssProps(this: HTMLElement, properties: Record<string, string>) {
          for (const [property, value] of Object.entries(properties)) {
            this.style.setProperty(property, value);
          }
        },
      });
    }
  }
}
