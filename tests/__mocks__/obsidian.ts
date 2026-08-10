/**
 * Runtime stub for the `obsidian` npm package, which ships type declarations
 * only. Vitest aliases `obsidian` here so service tests can import modules
 * that reference Obsidian's runtime classes without a real Obsidian host.
 *
 * Values that services actually branch on at runtime are implemented as
 * minimal no-op classes; anything the tests depend on for assertions is
 * mocked explicitly in the test itself.
 */
export class Notice {
  public constructor(_message: string) {
    // no-op in tests
  }
}

export class Plugin {
  public app!: import('obsidian').App;
  public manifest!: import('obsidian').PluginManifest;
  public loadData(): Promise<unknown> {
    return Promise.resolve(undefined);
  }
  public saveData(_data: unknown): Promise<void> {
    return Promise.resolve();
  }
  public addCommand(_command: import('obsidian').Command): void {
    // no-op
  }
  public addRibbonIcon(_icon: string, _title: string, _callback: () => void): HTMLElement {
    return document.createElement('div');
  }
  public addStatusBarItem(): HTMLElement {
    return document.createElement('div');
  }
  public addSettingTab(_tab: import('obsidian').PluginSettingTab): void {
    // no-op
  }
  public registerEvent(_eventRef: import('obsidian').EventRef): void {
    // no-op
  }
  public registerDomEvent<K extends keyof WindowEventMap>(
    _el: Window,
    _type: K,
    _callback: (this: Window, ev: WindowEventMap[K]) => unknown,
  ): void;
  public registerDomEvent<K extends keyof DocumentEventMap>(
    _el: Document,
    _type: K,
    _callback: (this: Document, ev: DocumentEventMap[K]) => unknown,
  ): void;
  public registerDomEvent(
    _el: Window | Document,
    _type: string,
    _callback: (...args: unknown[]) => unknown,
  ): void {
    // no-op
  }
  public registerEditorExtension(_extension: unknown): void {
    // no-op
  }
  public registerMarkdownPostProcessor(
    _postProcessor: import('obsidian').MarkdownPostProcessor,
  ): void {
    // no-op
  }
  public registerView(_type: string, _viewCreator: import('obsidian').ViewCreator): void {
    // no-op
  }
  public register(_cb: () => unknown): void {
    // no-op
  }
  public addCommandCallback?(): void {
    // no-op
  }
}

export class TFile {
  public path = '';
  public basename = '';
  public extension = 'md';
  public parent: import('obsidian').TFolder | null = null;
  public name = '';
  public vault!: import('obsidian').Vault;
}

export class TFolder {
  public path = '';
  public name = '';
  public parent: import('obsidian').TFolder | null = null;
  public children: import('obsidian').TAbstractFile[] = [];
}

export class MarkdownView {
  public leaf!: import('obsidian').WorkspaceLeaf;
  public contentEl!: HTMLElement;
  public file: import('obsidian').TFile | null = null;
}

export class Menu {
  public addItem(_cb: (item: import('obsidian').MenuItem) => unknown): this {
    return this;
  }
  public addSeparator(): this {
    return this;
  }
}

export function getAllTags(_cache: import('obsidian').CachedMetadata): string[] {
  return [];
}

export function normalizePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

export function stringifyYaml(_obj: unknown): string {
  return '';
}

export const Platform = {
  isMobile: false,
  isDesktop: true,
};
