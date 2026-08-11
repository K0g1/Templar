import {
  MarkdownView,
  Menu,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
  getAllTags,
  normalizePath,
  stringifyYaml,
  type WorkspaceLeaf,
} from 'obsidian';
import { createHideMetadataExtension } from './editor/hide-metadata';
import {
  DEFAULT_TEMPLATE_ID,
  TEMPLAR_ICON,
  TEMPLAR_VIEW_TYPE,
} from './constants';
import { FrontmatterService } from './services/frontmatter';
import { FontMetricsService } from './services/font-metrics';
import { PageRenderer } from './services/page-renderer';
import { PreviewSessionService } from './services/preview-session';
import { NoteStyleIndex } from './services/note-style-index';
import { PrintService } from './services/print-service';
import { firstMatchingRule, pageFlowOptions } from './services/style-rules';
import { noteTemplateSnapshot } from './services/synchronization';
import { TemplateLibrary } from './services/template-library';
import { DEFAULT_PAGE_OPTIONS, DEFAULT_SETTINGS } from './templates/defaults';
import { TEMPLAR_LLM_AUTHORING_KIT } from './templates/llm-kit';
import { normalizeSettings } from './templates/settings';
import { templateToExportObject } from './templates/note-format';
import { templatePackToExportObject } from './services/template-pack';
import type { NotePageOptions, TemplarNoteStyle, TemplarSettings, TemplarTemplate } from './types';
import { writeTextToClipboard } from './utils/clipboard';
import { clone, slugify } from './utils/value';
import {
  BatchApplyModal,
  ApplyStyleModal,
  CreateStyledNoteModal,
  CurrentNoteInspectorModal,
  PageModeModal,
  RawStyleModal,
  StylePickerModal,
  TemplateCreatorModal,
  TemplateImportModal,
  TemplatePackExportModal,
  SynchronizationReviewModal,
  StyleRulesModal,
} from './ui/modals';
import { TemplarSettingTab } from './ui/settings-tab';
import { TemplarStylesView } from './ui/styles-view';

export default class TemplarPlugin extends Plugin {
  public settings: TemplarSettings = clone(DEFAULT_SETTINGS);
  public library!: TemplateLibrary;
  public frontmatter!: FrontmatterService;
  public fontMetrics!: FontMetricsService;
  public renderer!: PageRenderer;
  public preview!: PreviewSessionService;
  public usageIndex = new NoteStyleIndex();
  public printService!: PrintService;

  private statusBarEl: HTMLElement | null = null;
  private lastMarkdownLeaf: WorkspaceLeaf | null = null;
  private rulesReady = false;

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.frontmatter = new FrontmatterService(this.app);
    this.fontMetrics = new FontMetricsService(() => this.settings.fontCacheSize);
    this.library = new TemplateLibrary(this.settings, async () => this.saveSettings());
    this.renderer = new PageRenderer(
      this.app,
      this.settings,
      this.frontmatter,
      this.fontMetrics,
    );
    this.preview = new PreviewSessionService(
      this.settings,
      this.frontmatter,
      this.renderer,
    );
    this.printService = new PrintService(this.frontmatter, this.renderer);

    this.registerView(
      TEMPLAR_VIEW_TYPE,
      (leaf) => new TemplarStylesView(leaf, this),
    );
    this.registerEditorExtension(
      createHideMetadataExtension(() => this.settings.hideStyleMetadata),
    );
    this.addSettingTab(new TemplarSettingTab(this.app, this));
    this.registerCommands();
    this.registerEvents();
    this.registerDomEvent(document, 'keydown', (event) => {
      if (event.defaultPrevented || event.key !== 'Escape') return;
      const session = this.preview.current();
      if (!session) return;
      event.preventDefault();
      void this.preview.cancel(session.owner).then(() => this.refreshSidebars());
    });

    this.addRibbonIcon(TEMPLAR_ICON, 'Open page styles', () => {
      void this.openStylesView();
    });
    if (!Platform.isMobile) {
      this.statusBarEl = this.addStatusBarItem();
      this.statusBarEl.addClass('templar-status');
    }

    const fonts = document.fonts;
    const handleFontsLoaded = (): void => {
      this.fontMetrics.clear();
      this.renderer.scheduleRefreshAll();
    };
    fonts.addEventListener('loadingdone', handleFontsLoaded);
    this.register(() => fonts.removeEventListener('loadingdone', handleFontsLoaded));

    this.app.workspace.onLayoutReady(() => {
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) this.lastMarkdownLeaf = activeView.leaf;
      this.rulesReady = true;
      this.registerEvent(this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') void this.evaluateStyleRules(file, false);
      }));
      this.renderer.scheduleRefreshAll();
      this.updateStatusBar();
    });
  }

  public onunload(): void {
    this.printService.destroy();
    this.preview.destroy();
    this.renderer.destroy();
  }

  public async loadSettings(): Promise<void> {
    this.settings = normalizeSettings(await this.loadData());
  }

  public async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  public activeFile(): TFile | null {
    const file =
      this.app.workspace.getActiveViewOfType(MarkdownView)?.file ??
      this.app.workspace.getActiveFile();
    return file?.extension === 'md' ? file : null;
  }

  public activeMarkdownLeaf(): WorkspaceLeaf | null {
    return this.app.workspace.getActiveViewOfType(MarkdownView)?.leaf ?? this.lastMarkdownLeaf;
  }

  public ensureUsageIndex(): void {
    this.usageIndex.ensureBuilt(() => this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      folder: file.parent?.path ?? '',
      style: this.frontmatter.getStyle(file),
    })));
  }

  public async applyTemplate(
    template: TemplarTemplate,
    file = this.activeFile(),
    pageOptions?: NotePageOptions,
    options: { recordRecent?: boolean; notify?: boolean; appliedByRule?: { id: string; name: string } } = {},
  ): Promise<void> {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    if (!options.appliedByRule) await this.preview.cancelAll();
    const existing = this.frontmatter.getStyle(file);
    const defaultFlow = pageFlowOptions(this.settings.defaultNewPageFlow);
    const resolvedPageOptions = pageOptions ?? existing?.page ?? {
      ...clone(DEFAULT_PAGE_OPTIONS),
      ...defaultFlow,
    };
    await this.frontmatter.applyTemplate(
      file,
      template,
      resolvedPageOptions,
      options.appliedByRule,
    );
    if (options.recordRecent !== false && !options.appliedByRule) {
      await this.library.recordRecent(template.id);
    }
    if (this.usageIndex.isBuilt()) {
      this.usageIndex.update({
        path: file.path,
        folder: file.parent?.path ?? '',
        style: this.frontmatter.getStyle(file),
      });
    }
    await this.renderer.refreshFile(file);
    this.refreshSidebars();
    this.updateStatusBar();
    if (options.notify !== false) new Notice(`Applied “${template.name}” to ${file.basename}.`);
  }

  public async removeStyle(file = this.activeFile()): Promise<void> {
    if (!file || !this.frontmatter.hasStyle(file)) {
      new Notice('The active note does not have a page style.');
      return;
    }
    await this.frontmatter.removeStyle(file);
    if (this.usageIndex.isBuilt()) {
      this.usageIndex.update({ path: file.path, folder: file.parent?.path ?? '', style: null });
    }
    await this.renderer.refreshFile(file);
    this.refreshSidebars();
    this.updateStatusBar();
    new Notice(`Removed Templar styling from ${file.basename}.`);
  }

  public showStylePicker(file = this.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before choosing a page style.');
      return;
    }
    new StylePickerModal(this, file, 'apply').open();
  }

  public showApplyTemplate(template: TemplarTemplate, file = this.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    void this.applyTemplate(template, file);
  }

  public showApplyWithOptions(template: TemplarTemplate, file = this.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    new ApplyStyleModal(this, file, template).open();
  }

  public showNewNoteStylePicker(): void {
    new StylePickerModal(this, null, 'create').open();
  }

  public showCreateStyledNote(template: TemplarTemplate): void {
    new CreateStyledNoteModal(this, template).open();
  }

  public showPageMode(file = this.activeFile()): void {
    const style = file ? this.frontmatter.getStyle(file) : null;
    if (!file || !style) {
      new Notice('Apply a page style before changing page mode.');
      return;
    }
    new PageModeModal(this, file, style).open();
  }

  public showTemplateCreator(template?: TemplarTemplate): void {
    new TemplateCreatorModal(this, template).open();
  }

  public showTemplateImporter(): void {
    new TemplateImportModal(this).open();
  }

  public showPackExporter(templates?: TemplarTemplate[]): void {
    new TemplatePackExportModal(this, templates).open();
  }

  public showSynchronizationReview(templateId?: string): void {
    new SynchronizationReviewModal(this, templateId).open();
  }

  public showStyleRules(): void {
    new StyleRulesModal(this).open();
  }

  public showRawStyleEditor(file = this.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before editing its raw style.');
      return;
    }
    const style = this.frontmatter.getStyle(file);
    if (!style) {
      new Notice('Apply a page style to this note first.');
      return;
    }
    void this.preview.cancelAll().then(() => new RawStyleModal(this, file, style).open());
  }

  public showCurrentNoteInspector(file = this.activeFile()): void {
    const style = file ? this.frontmatter.getStyle(file) : null;
    if (!file || !style) return;
    new CurrentNoteInspectorModal(this, file, style).open();
  }

  public async printStyledNote(file = this.activeFile()): Promise<void> {
    const leaf = this.activeMarkdownLeaf();
    if (!file || !leaf || !this.printService.available(leaf)) {
      new Notice('Printing is not available for the active note on this platform.');
      return;
    }
    try {
      await this.printService.print(leaf, file);
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  public showBatchApply(): void {
    new BatchApplyModal(this).open();
  }

  public async openStylesView(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.app.workspace.getRightLeaf(false);
      if (!leaf) {
        return;
      }
      await leaf.setViewState({ type: TEMPLAR_VIEW_TYPE, active: true });
    }
    await this.app.workspace.revealLeaf(leaf);
  }

  public async focusStyleSearch(): Promise<void> {
    await this.openStylesView();
    const leaf = this.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0];
    if (leaf?.view instanceof TemplarStylesView) leaf.view.focusSearch();
  }

  public async cycleFavouritePreview(direction: 1 | -1): Promise<void> {
    await this.openStylesView();
    const leaf = this.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0];
    if (leaf?.view instanceof TemplarStylesView) leaf.view.previewNextFavourite(direction);
  }

  public async applyCurrentPreview(): Promise<void> {
    const session = this.preview.current();
    if (!session) return;
    await this.preview.cancel(session.owner);
    await this.applyTemplate(noteTemplateSnapshot(session.style), session.file, session.style.page);
  }

  public async copyAuthoringKit(): Promise<void> {
    try {
      await writeTextToClipboard(TEMPLAR_LLM_AUTHORING_KIT);
      new Notice('Template authoring skill copied.');
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  public async exportAuthoringKit(): Promise<void> {
    const base = 'Templar Template Authoring Skill';
    let path = normalizePath(`${base}.md`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${base} ${String(suffix)}.md`);
      suffix += 1;
    }
    await this.app.vault.create(path, TEMPLAR_LLM_AUTHORING_KIT);
    new Notice(`Exported ${path}.`);
  }

  public async exportTemplate(template: TemplarTemplate): Promise<void> {
    const folder = normalizePath('Templar Templates');
    const existingFolder = this.app.vault.getAbstractFileByPath(folder);
    if (existingFolder && !(existingFolder instanceof TFolder)) {
      new Notice(`Cannot export because “${folder}” is a file.`);
      return;
    }
    if (!existingFolder) {
      await this.app.vault.createFolder(folder);
    }
    const baseName = slugify(template.name);
    let path = normalizePath(`${folder}/${baseName}.templar`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folder}/${baseName}-${String(suffix)}.templar`);
      suffix += 1;
    }
    await this.app.vault.create(path, stringifyYaml(templateToExportObject(template)));
    new Notice(`Exported ${path}.`);
  }

  public async exportTemplatePack(
    metadata: { name: string; description: string; author: string; tags: string[] },
    templates: TemplarTemplate[],
  ): Promise<void> {
    const folder = normalizePath('Templar Templates');
    const existingFolder = this.app.vault.getAbstractFileByPath(folder);
    if (existingFolder && !(existingFolder instanceof TFolder)) throw new Error(`“${folder}” is a file.`);
    if (!existingFolder) await this.app.vault.createFolder(folder);
    const base = slugify(metadata.name || 'templar-style-pack');
    let path = normalizePath(`${folder}/${base}.templar-pack`);
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) path = normalizePath(`${folder}/${base}-${String(suffix++)}.templar-pack`);
    await this.app.vault.create(path, stringifyYaml(templatePackToExportObject(metadata, templates)));
    new Notice(`Exported ${String(templates.length)} styles to ${path}.`);
  }

  public refreshEverything(): void {
    this.fontMetrics.clear();
    this.app.workspace.updateOptions();
    this.renderer.scheduleRefreshAll();
    this.refreshSidebars();
    this.updateStatusBar();
  }

  public refreshSidebars(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)) {
      if (leaf.view instanceof TemplarStylesView) {
        leaf.view.render();
      }
    }
  }

  private async writeAndRefresh(file: TFile, style: TemplarNoteStyle): Promise<void> {
    await this.frontmatter.writeStyle(file, style);
    await this.renderer.refreshFile(file);
    this.refreshSidebars();
    this.updateStatusBar();
  }

  private async evaluateStyleRules(file: TFile, metadataReady: boolean): Promise<void> {
    if (!this.rulesReady || this.frontmatter.hasStyle(file)) return;
    const cache = this.app.metadataCache.getFileCache(file);
    const rule = firstMatchingRule(this.settings.styleRules, {
      path: file.path,
      basename: file.basename,
      folder: file.parent?.path ?? '',
      tags: cache ? getAllTags(cache) ?? [] : [],
      frontmatter: cache?.frontmatter ?? {},
      metadataReady: metadataReady && cache !== null,
    });
    if (!rule) return;
    const template = this.library.get(rule.templateId);
    if (!template) return;
    const flow = pageFlowOptions(rule.pageFlow === 'default' ? this.settings.defaultNewPageFlow : rule.pageFlow);
    await this.applyTemplate(template, file, { ...clone(DEFAULT_PAGE_OPTIONS), ...flow }, {
      recordRecent: false,
      appliedByRule: { id: rule.id, name: rule.name },
    });
  }

  private registerCommands(): void {
    this.addCommand({
      id: 'open-page-styles',
      name: 'Open page styles',
      callback: () => void this.openStylesView(),
    });
    this.addCommand({
      id: 'choose-page-style',
      name: 'Choose page style…',
      checkCallback: (checking) => {
        const available = this.activeFile() !== null;
        if (available && !checking) {
          this.showStylePicker();
        }
        return available;
      },
    });
    this.addCommand({ id: 'focus-style-search', name: 'Focus style search', callback: () => void this.focusStyleSearch() });
    this.addCommand({
      id: 'customize-current-note', name: 'Customize current note',
      checkCallback: (checking) => {
        const file = this.activeFile(); const available = file !== null && this.frontmatter.hasStyle(file);
        if (available && !checking) this.showCurrentNoteInspector(file);
        return available;
      },
    });
    this.addCommand({
      id: 'apply-last-used-style', name: 'Apply last used style',
      checkCallback: (checking) => {
        const file = this.activeFile(); const template = this.library.get(this.settings.recentTemplateIds[0] ?? '');
        const available = file !== null && template !== null;
        if (available && !checking) void this.applyTemplate(template, file);
        return available;
      },
    });
    this.addCommand({ id: 'next-favorite-style', name: 'Next favorite style', checkCallback: (checking) => { const available = this.activeFile() !== null && this.settings.favouriteTemplateIds.length > 0; if (available && !checking) void this.cycleFavouritePreview(1); return available; } });
    this.addCommand({ id: 'previous-favorite-style', name: 'Previous favorite style', checkCallback: (checking) => { const available = this.activeFile() !== null && this.settings.favouriteTemplateIds.length > 0; if (available && !checking) void this.cycleFavouritePreview(-1); return available; } });
    this.addCommand({ id: 'apply-previewed-style', name: 'Apply previewed style', checkCallback: (checking) => { const available = this.preview.current() !== null; if (available && !checking) void this.applyCurrentPreview(); return available; } });
    this.addCommand({ id: 'cancel-style-preview', name: 'Cancel style preview', checkCallback: (checking) => { const available = this.preview.current() !== null; if (available && !checking) void this.preview.cancelAll().then(() => this.refreshSidebars()); return available; } });
    this.addCommand({
      id: 'apply-default-page-style',
      name: 'Apply default page style',
      checkCallback: (checking) => {
        const file = this.activeFile();
        if (!file) {
          return false;
        }
        if (!checking) {
          const template =
            this.library.get(this.settings.defaultTemplateId) ??
            this.library.get(DEFAULT_TEMPLATE_ID);
          if (template) {
            void this.applyTemplate(template, file);
          }
        }
        return true;
      },
    });
    this.addCommand({
      id: 'remove-page-style',
      name: 'Remove page style',
      checkCallback: (checking) => {
        const file = this.activeFile();
        const available = file !== null && this.frontmatter.hasStyle(file);
        if (available && !checking) {
          void this.removeStyle(file);
        }
        return available;
      },
    });
    this.addCommand({
      id: 'edit-raw-style',
      name: 'Edit raw style…',
      checkCallback: (checking) => {
        const file = this.activeFile();
        const available = file !== null && this.frontmatter.hasStyle(file);
        if (available && !checking) {
          this.showRawStyleEditor();
        }
        return available;
      },
    });
    this.addCommand({
      id: 'create-page-style',
      name: 'Create page style…',
      callback: () => this.showTemplateCreator(),
    });
    this.addCommand({
      id: 'create-styled-note',
      name: 'Create styled note…',
      callback: () => this.showNewNoteStylePicker(),
    });
    this.addCommand({
      id: 'change-page-mode',
      name: 'Change page mode…',
      checkCallback: (checking) => {
        const file = this.activeFile();
        const available = file !== null && this.frontmatter.hasStyle(file);
        if (available && !checking) {
          this.showPageMode();
        }
        return available;
      },
    });
    this.addCommand({
      id: 'toggle-paged-pageless', name: 'Toggle paged / pageless',
      checkCallback: (checking) => {
        const file = this.activeFile(); const style = file ? this.frontmatter.getStyle(file) : null;
        if (file && style && !checking) { style.page.mode = style.page.mode === 'paged' ? 'pageless' : 'paged'; void this.writeAndRefresh(file, style); }
        return Boolean(file && style);
      },
    });
    this.addCommand({
      id: 'toggle-fit-narrow-screens', name: 'Toggle fit narrow screens',
      checkCallback: (checking) => {
        const file = this.activeFile(); const style = file ? this.frontmatter.getStyle(file) : null;
        const available = Boolean(file && style?.page.mode === 'paged');
        if (available && !checking && file && style) { style.page.scaleToFit = !style.page.scaleToFit; void this.writeAndRefresh(file, style); }
        return available;
      },
    });
    this.addCommand({ id: 'review-template-updates', name: 'Review template updates', callback: () => this.showSynchronizationReview() });
    this.addCommand({ id: 'manage-style-rules', name: 'Manage style rules', callback: () => this.showStyleRules() });
    this.addCommand({
      id: 'print-export-styled-note', name: 'Print / export styled note',
      checkCallback: (checking) => { const file = this.activeFile(); const leaf = this.activeMarkdownLeaf(); const available = Boolean(file && leaf && this.frontmatter.hasStyle(file) && this.printService.available(leaf)); if (available && !checking) void this.printStyledNote(file); return available; },
    });
    this.addCommand({
      id: 'import-page-style',
      name: 'Import page style…',
      callback: () => this.showTemplateImporter(),
    });
    this.addCommand({
      id: 'batch-apply-page-style',
      name: 'Apply page style to multiple notes…',
      callback: () => this.showBatchApply(),
    });
    this.addCommand({
      id: 'copy-template-authoring-skill',
      name: 'Copy LLM template authoring skill',
      callback: () => void this.copyAuthoringKit(),
    });
  }

  private registerEvents(): void {
    this.registerEvent(
      this.app.workspace.on('css-change', () => {
        this.fontMetrics.clear();
        this.renderer.scheduleRefreshAll();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('active-leaf-change', () => {
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
          if (this.lastMarkdownLeaf && this.lastMarkdownLeaf !== activeView.leaf) {
            void this.preview.cancelAll();
          }
          this.lastMarkdownLeaf = activeView.leaf;
        }
        this.renderer.scheduleRefreshAll();
        this.refreshSidebars();
        this.updateStatusBar();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        void this.preview.cancelMismatchedLeaves();
        this.renderer.scheduleRefreshAll();
        this.updateStatusBar();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => {
        // During a Reading/Editing mode rebuild, iterateAllLeaves can omit the
        // active Markdown leaf for one layout event even though the leaf is
        // still connected and getLeavesOfType already reports it. Preview
        // sessions are Markdown-only, so use the authoritative typed list and
        // avoid cancelling a try-on merely because the renderer was swapped.
        const openLeaves = new Set(this.app.workspace.getLeavesOfType('markdown'));
        void this.preview.cancelMissingLeaves(openLeaves).then((changed) => {
          if (changed) this.refreshSidebars();
        });
        this.renderer.scheduleRefreshAll();
      }),
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.frontmatter.settle(file);
        if (this.usageIndex.isBuilt()) {
          this.usageIndex.update({ path: file.path, folder: file.parent?.path ?? '', style: this.frontmatter.getStyle(file) });
        }
        void this.evaluateStyleRules(file, true);
        void this.renderer.refreshFile(file);
        if (this.activeFile()?.path === file.path) {
          this.refreshSidebars();
          this.updateStatusBar();
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          if (file.extension === 'md') void this.preview.cancelAll().then(() => this.refreshSidebars());
          this.frontmatter.rename(oldPath, file.path);
          if (this.usageIndex.isBuilt()) {
            this.usageIndex.rename(oldPath, { path: file.path, folder: file.parent?.path ?? '', style: this.frontmatter.getStyle(file) });
          }
          if (file.extension === 'md') void this.evaluateStyleRules(file, true);
        }
        this.renderer.scheduleRefreshAll();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') void this.preview.cancelAll().then(() => this.refreshSidebars());
        this.frontmatter.forget(file.path);
        if (this.usageIndex.isBuilt()) this.usageIndex.remove(file.path);
        this.renderer.scheduleRefreshAll();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('editor-menu', (menu: Menu) => {
        const file = this.activeFile();
        if (!file) {
          return;
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle('Apply page style…')
            .setIcon(TEMPLAR_ICON)
            .onClick(() => this.showStylePicker(file)),
        );
        if (this.frontmatter.hasStyle(file)) {
          menu.addItem((item) =>
            item
              .setTitle('Customize current note…')
              .setIcon('sliders-horizontal')
              .onClick(() => this.showCurrentNoteInspector(file)),
          );
          menu.addItem((item) =>
            item
              .setTitle('Remove page style')
              .setIcon('eraser')
              .onClick(() => void this.removeStyle(file)),
          );
        }
      }),
    );
    this.registerMarkdownPostProcessor((element, context) => {
      this.renderer.registerReadingSection(element, context);
      this.renderer.scheduleRefreshAll();
    });
  }

  public updateStatusBar(): void {
    if (!this.statusBarEl) {
      return;
    }
    const file = this.activeFile();
    const style = file ? this.frontmatter.getStyle(file) : null;
    this.statusBarEl.setText(style ? `Templar: ${style.name}` : '');
    this.statusBarEl.toggleClass('is-hidden', !style);
  }
}
