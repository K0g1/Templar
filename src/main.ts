import {
  MarkdownView,
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
import { registerCommands } from './commands/register';
import { registerEvent as registerPluginEvent, registerEvents } from './events/register';
import {
  TEMPLAR_ICON,
  TEMPLAR_VIEW_TYPE,
} from './constants';
import { FrontmatterService } from './services/frontmatter';
import { FontMetricsService } from './services/font-metrics';
import { PageRenderer } from './services/page-renderer';
import { PreviewSessionService } from './services/preview-session';
import { bindPreviewEscape } from './services/preview-keyboard';
import { NoteStyleIndex } from './services/note-style-index';
import { PrintService } from './services/print-service';
import { SettingsStore } from './services/settings-store';
import { StyleApplicationService } from './services/style-application';
import { firstMatchingRule, pageFlowOptions } from './services/style-rules';
import { noteTemplateSnapshot } from './services/synchronization';
import { TemplateLibrary } from './services/template-library';
import { DEFAULT_PAGE_OPTIONS, DEFAULT_SETTINGS } from './templates/defaults';
import { TEMPLAR_LLM_AUTHORING_KIT } from './templates/llm-kit';
import { normalizeSettingsWithIssues } from './templates/settings';
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
  public settingsStore!: SettingsStore;
  public library!: TemplateLibrary;
  public frontmatter!: FrontmatterService;
  public fontMetrics!: FontMetricsService;
  public renderer!: PageRenderer;
  public preview!: PreviewSessionService;
  public usageIndex = new NoteStyleIndex();
  public printService!: PrintService;
  public application!: StyleApplicationService;

  private statusBarEl: HTMLElement | null = null;
  public lastMarkdownLeaf: WorkspaceLeaf | null = null;
  private rulesReady = false;
  private settingsLoadIssueCount = 0;
  private readonly keyboardCleanups = new Map<Document, () => void>();

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.settingsStore = new SettingsStore(this.settings, async (value) => this.saveData(value));
    if (this.settingsLoadIssueCount > 0) {
      new Notice(`${String(this.settingsLoadIssueCount)} saved Templar style entr${this.settingsLoadIssueCount === 1 ? 'y was' : 'ies were'} quarantined because it was invalid.`);
    }
    this.frontmatter = new FrontmatterService(this.app);
    this.fontMetrics = new FontMetricsService(() => this.settings.fontCacheSize);
    this.library = new TemplateLibrary(this.settings, this.settingsStore);
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
    this.application = new StyleApplicationService({
      frontmatter: this.frontmatter,
      library: this.library,
      usageIndex: this.usageIndex,
      settings: this.settings,
      refreshFile: (file) => this.renderer.refreshFile(file),
      refreshDeferred: () => this.renderer.scheduleRefreshAll(),
      getCurrentFile: (path) => {
        const candidate = this.app.vault.getAbstractFileByPath(path);
        return candidate instanceof TFile && candidate.extension === 'md' ? candidate : null;
      },
    });
    this.printService = new PrintService(this.frontmatter, this.renderer);

    this.registerView(
      TEMPLAR_VIEW_TYPE,
      (leaf) => new TemplarStylesView(leaf, this),
    );
    this.registerEditorExtension(
      createHideMetadataExtension(() => this.settings.hideStyleMetadata),
    );
    this.addSettingTab(new TemplarSettingTab(this.app, this));
    registerCommands(this);
    registerEvents(this);
    const mainDocument = this.app.workspace.containerEl.ownerDocument;
    this.bindKeyboardDocument(mainDocument);
    registerPluginEvent(this, this.app.workspace.on('window-open', (_workspaceWindow, ownerWindow) => {
      this.bindKeyboardDocument(ownerWindow.document);
    }));
    registerPluginEvent(this, this.app.workspace.on('window-close', (_workspaceWindow, ownerWindow) => {
      this.unbindKeyboardDocument(ownerWindow.document);
    }));

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
      registerPluginEvent(this, this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') void this.evaluateStyleRules(file, false);
      }));
      this.renderer.scheduleRefreshAll();
      this.updateStatusBar();
    });
  }

  public onunload(): void {
    for (const cleanup of [...this.keyboardCleanups.values()]) cleanup();
    this.printService.destroy();
    this.preview.destroy();
    this.renderer.destroy();
  }

  public async loadSettings(): Promise<void> {
    const result = normalizeSettingsWithIssues(await this.loadData());
    this.settings = result.settings;
    this.settingsLoadIssueCount = result.issues.length;
  }

  public async saveSettings(): Promise<void> {
    if (!this.settingsStore) {
      await this.saveData(this.settings);
      return;
    }
    await this.settingsStore.persistCurrent();
  }

  public updateSettings<T>(mutate: (draft: TemplarSettings) => T): Promise<T> {
    if (!this.settingsStore) {
      throw new Error('Templar settings are not ready yet.');
    }
    return this.settingsStore.transaction(mutate);
  }

  private bindKeyboardDocument(ownerDocument: Document): void {
    if (this.keyboardCleanups.has(ownerDocument)) return;
    const unbind = bindPreviewEscape(ownerDocument, this.preview, () => this.activeMarkdownLeaf(), () => this.refreshSidebars());
    const cleanup = (): void => {
      unbind();
      if (this.keyboardCleanups.get(ownerDocument) === cleanup) {
        this.keyboardCleanups.delete(ownerDocument);
      }
    };
    this.keyboardCleanups.set(ownerDocument, cleanup);
    this.register(cleanup);
  }

  private unbindKeyboardDocument(ownerDocument: Document): void {
    this.keyboardCleanups.get(ownerDocument)?.();
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
    const result = await this.application.apply({
      file,
      template,
      pageOptions,
      appliedByRule: options.appliedByRule,
      recordRecent: options.recordRecent,
      refresh: 'immediate',
    });
    this.refreshSidebars();
    this.updateStatusBar();
    for (const warning of result.warnings) new Notice(warning.message);
    if (options.notify !== false) new Notice(`Applied “${template.name}” to ${file.basename}.`);
  }

  public async removeStyle(file = this.activeFile()): Promise<void> {
    if (!file || !this.frontmatter.hasStyle(file)) {
      new Notice('The active note does not have a page style.');
      return;
    }
    await this.application.removeStyle(file);
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

  public async applyCurrentPreview(leaf = this.activeMarkdownLeaf()): Promise<void> {
    const session = leaf ? this.preview.currentForLeaf(leaf) : null;
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

  public async writeAndRefresh(file: TFile, style: TemplarNoteStyle): Promise<void> {
    await this.application.writeStyle(file, style);
    this.refreshSidebars();
    this.updateStatusBar();
  }

  public async evaluateStyleRules(file: TFile, metadataReady: boolean): Promise<void> {
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
