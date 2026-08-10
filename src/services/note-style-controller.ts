import { Notice, TFile, getAllTags } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate, TemplarSettings } from '../types';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import { clone } from '../utils/value';
import { firstMatchingRule, pageFlowOptions } from './style-rules';

/**
 * The minimal plugin surface NoteStyleController needs. Keeping this a
 * structural interface (rather than importing the concrete plugin class)
 * makes the controller independently testable and prevents it from reaching
 * into unrelated plugin responsibilities.
 */
export interface NoteStyleControllerHost {
  settings: TemplarSettings;
  frontmatter: {
    getStyle(file: TFile): TemplarNoteStyle | null;
    hasStyle(file: TFile): boolean;
    applyTemplate(
      file: TFile,
      template: TemplarTemplate,
      pageOptions?: NotePageOptions,
      appliedByRule?: { id: string; name: string },
    ): Promise<void>;
    removeStyle(file: TFile): Promise<void>;
    writeStyle(file: TFile, style: TemplarNoteStyle): Promise<void>;
  };
  library: {
    get(templateId: string): TemplarTemplate | null;
    recordRecent(templateId: string): Promise<void>;
  };
  usageIndex: {
    isBuilt(): boolean;
    update(entry: { path: string; folder: string; style: TemplarNoteStyle | null }): void;
  };
  renderer: {
    refreshFile(file: TFile): Promise<void>;
  };
  preview: {
    cancelAll(): Promise<void>;
  };
  app: {
    metadataCache: {
      getFileCache(file: TFile): { frontmatter?: Record<string, unknown> } | null;
    };
  };
  refreshSidebars(): void;
  updateStatusBar(): void;
}

/**
 * Owns the note-level style workflows: applying templates, removing styles,
 * persisting page-option changes, and evaluating automatic style rules.
 *
 * Keeping this out of the plugin class keeps `main.ts` as lifecycle and
 * facade orchestration. The controller still coordinates through the host
 * for UI touches (sidebars, status bar) and the renderer, but the business
 * rules live here with a single owner.
 */
export class NoteStyleController {
  private rulesReady = false;

  public constructor(private readonly plugin: NoteStyleControllerHost) {}

  /** Marks style-rule evaluation as safe to run (after layout is ready). */
  public markRulesReady(): void {
    this.rulesReady = true;
  }

  public async applyTemplate(
    template: TemplarTemplate,
    file: TFile | null,
    pageOptions?: NotePageOptions,
    options: { recordRecent?: boolean; notify?: boolean; appliedByRule?: { id: string; name: string } } = {},
  ): Promise<void> {
    const { plugin } = this;
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    if (!options.appliedByRule) await plugin.preview.cancelAll();
    const existing = plugin.frontmatter.getStyle(file);
    const defaultFlow = pageFlowOptions(plugin.settings.defaultNewPageFlow);
    const resolvedPageOptions = pageOptions ?? existing?.page ?? {
      ...clone(DEFAULT_PAGE_OPTIONS),
      ...defaultFlow,
    };
    await plugin.frontmatter.applyTemplate(
      file,
      template,
      resolvedPageOptions,
      options.appliedByRule,
    );
    if (options.recordRecent !== false && !options.appliedByRule) {
      await plugin.library.recordRecent(template.id);
    }
    if (plugin.usageIndex.isBuilt()) {
      plugin.usageIndex.update({
        path: file.path,
        folder: file.parent?.path ?? '',
        style: plugin.frontmatter.getStyle(file),
      });
    }
    await plugin.renderer.refreshFile(file);
    plugin.refreshSidebars();
    plugin.updateStatusBar();
    if (options.notify !== false) new Notice(`Applied “${template.name}” to ${file.basename}.`);
  }

  public async removeStyle(file: TFile | null): Promise<void> {
    const { plugin } = this;
    if (!file || !plugin.frontmatter.hasStyle(file)) {
      new Notice('The active note does not have a page style.');
      return;
    }
    await plugin.frontmatter.removeStyle(file);
    if (plugin.usageIndex.isBuilt()) {
      plugin.usageIndex.update({ path: file.path, folder: file.parent?.path ?? '', style: null });
    }
    await plugin.renderer.refreshFile(file);
    plugin.refreshSidebars();
    plugin.updateStatusBar();
    new Notice(`Removed Templar styling from ${file.basename}.`);
  }

  public async writeAndRefresh(file: TFile, style: TemplarNoteStyle): Promise<void> {
    const { plugin } = this;
    await plugin.frontmatter.writeStyle(file, style);
    await plugin.renderer.refreshFile(file);
    plugin.refreshSidebars();
    plugin.updateStatusBar();
  }

  public async evaluateStyleRules(file: TFile, metadataReady: boolean): Promise<void> {
    const { plugin } = this;
    if (!this.rulesReady || plugin.frontmatter.hasStyle(file)) return;
    const cache = plugin.app.metadataCache.getFileCache(file);
    const rule = firstMatchingRule(plugin.settings.styleRules, {
      path: file.path,
      basename: file.basename,
      folder: file.parent?.path ?? '',
      tags: cache ? getAllTags(cache) ?? [] : [],
      frontmatter: cache?.frontmatter ?? {},
      metadataReady: metadataReady && cache !== null,
    });
    if (!rule) return;
    const template = plugin.library.get(rule.templateId);
    if (!template) return;
    const flow = pageFlowOptions(rule.pageFlow === 'default' ? plugin.settings.defaultNewPageFlow : rule.pageFlow);
    await this.applyTemplate(template, file, { ...clone(DEFAULT_PAGE_OPTIONS), ...flow }, {
      recordRecent: false,
      appliedByRule: { id: rule.id, name: rule.name },
    });
  }
}
