import {
  MarkdownView,
  Notice,
  Platform,
  Plugin,
  TFile,
  TFolder,
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
import { NoteStyleController } from './services/note-style-controller';
import { CommandRegistrar } from './registration/commands';
import { WorkspaceEventController } from './registration/events';
import { noteTemplateSnapshot } from './services/synchronization';
import { TemplateLibrary } from './services/template-library';
import { DEFAULT_SETTINGS } from './templates/defaults';
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
  public styleController!: NoteStyleController;

  private statusBarEl: HTMLElement | null = null;
  public lastMarkdownLeaf: WorkspaceLeaf | null = null;

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
    this.styleController = new NoteStyleController(this);

    this.registerView(
      TEMPLAR_VIEW_TYPE,
      (leaf) => new TemplarStylesView(leaf, this),
    );
    this.registerEditorExtension(
      createHideMetadataExtension(() => this.settings.hideStyleMetadata),
    );
    this.addSettingTab(new TemplarSettingTab(this.app, this));
    new CommandRegistrar(this).register();
    new WorkspaceEventController(this).register();
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
      this.styleController.markRulesReady();
      this.registerEvent(this.app.vault.on('create', (file) => {
        if (file instanceof TFile && file.extension === 'md') void this.styleController.evaluateStyleRules(file, false);
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
    file: TFile | null = this.activeFile(),
    pageOptions?: NotePageOptions,
    options: { recordRecent?: boolean; notify?: boolean; appliedByRule?: { id: string; name: string } } = {},
  ): Promise<void> {
    await this.styleController.applyTemplate(template, file, pageOptions, options);
  }

  public async removeStyle(file: TFile | null = this.activeFile()): Promise<void> {
    await this.styleController.removeStyle(file);
  }

  public async writeAndRefresh(file: TFile, style: TemplarNoteStyle): Promise<void> {
    await this.styleController.writeAndRefresh(file, style);
  }

  public async evaluateStyleRules(file: TFile, metadataReady: boolean): Promise<void> {
    await this.styleController.evaluateStyleRules(file, metadataReady);
  }

  public defaultTemplateId(): string {
    return this.settings.defaultTemplateId || DEFAULT_TEMPLATE_ID;
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
