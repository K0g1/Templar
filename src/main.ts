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
import { registerCommands } from './commands/register';
import { registerEvent as registerPluginEvent, registerEvents } from './events/register';
import {
  TEMPLAR_ICON,
  TEMPLAR_VIEW_TYPE,
} from './constants';
import { FrontmatterService } from './services/frontmatter';
import { RecoveryService } from './services/recovery-service';
import { FontMetricsService } from './services/font-metrics';
import { PageRenderer } from './services/page-renderer';
import { PreviewSessionService } from './services/preview-session';
import { bindPreviewEscape } from './services/preview-keyboard';
import { NoteStyleIndex } from './services/note-style-index';
import { PrintService } from './services/print-service';
import { SettingsStore } from './services/settings-store';
import { StyleApplicationService } from './services/style-application';
import { StyleRuleEngine } from './services/style-rule-engine';
import { AuthoringKitService } from './services/authoring-kit-service';
import { noteTemplateSnapshot } from './services/synchronization';
import { TemplateLibrary } from './services/template-library';
import { DEFAULT_SETTINGS } from './templates/defaults';
import { settingsToPersistedData, type QuarantinedTemplate } from './templates/settings';
import { loadVersionedSettings } from './migrations/settings-loader';
import { templateToExportObject } from './templates/note-format';
import { templatePackToExportObject } from './services/template-pack';
import type { NotePageOptions, TemplarNoteStyle, TemplarSettings, TemplarTemplate } from './types';
import { clone, slugify } from './utils/value';
import { PluginUiController } from './ui/plugin-ui-controller';
import { TemplarSettingTab } from './ui/settings-tab';
import { TemplarStylesView } from './ui/styles-view';
import { reportSingleFileOperation, runBackgroundTask, runUserAction } from './ui/async-actions';

export default class TemplarPlugin extends Plugin {
  public settings: TemplarSettings = clone(DEFAULT_SETTINGS);
  public settingsStore!: SettingsStore;
  public library!: TemplateLibrary;
  public frontmatter!: FrontmatterService;
  public recovery!: RecoveryService;
  public fontMetrics!: FontMetricsService;
  public renderer!: PageRenderer;
  public preview!: PreviewSessionService;
  public usageIndex = new NoteStyleIndex();
  public printService!: PrintService;
  public application!: StyleApplicationService;
  public ui!: PluginUiController;
  public quarantinedTemplates: QuarantinedTemplate[] = [];

  private statusBarEl: HTMLElement | null = null;
  public lastMarkdownLeaf: WorkspaceLeaf | null = null;
  private rulesReady = false;
  private settingsLoadIssueCount = 0;
  private pendingSettingsMigration = false;
  private pendingSettingsMigrationRaw: unknown = null;
  private protectedSettingsRaw: unknown = null;
  private protectedSettingsStatus: 'unsupported-future' | 'invalid' | 'migration-failed' | null = null;
  private lastSettingsRecoveryPath: string | null = null;
  private authoringKit!: AuthoringKitService;
  private ruleEngine!: StyleRuleEngine;
  private readonly keyboardCleanups = new Map<Document, () => void>();

  public async onload(): Promise<void> {
    await this.loadSettings();
    this.recovery = new RecoveryService(this.app, this.manifest.version);
    this.settingsStore = new SettingsStore(this.settings, async (value) => this.persistSettingsCandidate(value));
    if (this.settingsLoadIssueCount > 0) {
      new Notice(`${String(this.settingsLoadIssueCount)} saved Templar style entr${this.settingsLoadIssueCount === 1 ? 'y was' : 'ies were'} quarantined because it was invalid.`);
    }
    if (this.protectedSettingsRaw !== null) {
      new Notice('Templar could not safely interpret stored settings. Safe defaults are active and the original data will not be overwritten automatically.');
    } else if (this.pendingSettingsMigration) {
      new Notice('Templar loaded older settings in compatibility mode. Finalize migration to write versioned settings. A recovery copy will be created first.');
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
    this.ui = new PluginUiController(this);
    this.authoringKit = new AuthoringKitService(this.app);
    this.ruleEngine = new StyleRuleEngine({
      app: this.app,
      settings: this.settings,
      library: this.library,
      frontmatter: this.frontmatter,
      isReady: () => this.rulesReady,
      apply: ({ template, file, pageOptions, appliedByRule, guard }) => this.applyTemplate(
        template,
        file,
        pageOptions,
        { recordRecent: false, appliedByRule, guard },
      ),
    });

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

    this.addRibbonIcon(TEMPLAR_ICON, 'Open page styles', () => runUserAction(() => this.openStylesView(), 'Could not open Page Styles'));
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
        if (file instanceof TFile && file.extension === 'md') {
          runBackgroundTask(() => this.evaluateStyleRules(file, false), 'Could not evaluate style rules for the new note');
        }
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
    const result = loadVersionedSettings(await this.loadData());
    this.settings = result.settings;
    this.quarantinedTemplates = result.issues;
    this.settingsLoadIssueCount = result.issues.length;
    this.pendingSettingsMigration = result.status === 'migrated';
    this.pendingSettingsMigrationRaw = this.pendingSettingsMigration ? clone(result.raw) : null;
    this.protectedSettingsRaw = result.protectedRaw ?? null;
    this.protectedSettingsStatus = result.protectedRaw !== undefined &&
      (result.status === 'unsupported-future' || result.status === 'invalid' || result.status === 'migration-failed')
      ? result.status
      : null;
  }

  public async saveSettings(): Promise<void> {
    if (!this.settingsStore) {
      await this.persistSettingsCandidate(this.settings);
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

  public async removeQuarantinedTemplate(index: number): Promise<void> {
    const previous = this.quarantinedTemplates;
    const entry = previous.find((candidate) => candidate.index === index);
    this.quarantinedTemplates = previous.filter((entry) => entry.index !== index);
    try {
      if (entry) {
        await this.recovery.backupRaw(
          'template-import',
          entry.raw,
          entry.templateId ?? `quarantined-${String(index)}`,
          typeof entry.raw === 'object' && entry.raw !== null && !Array.isArray(entry.raw) &&
            typeof (entry.raw as Record<string, unknown>).version === 'number'
            ? (entry.raw as Record<string, unknown>).version as number
            : null,
          'manual-remove',
        );
      }
      await this.settingsStore.persistCurrent();
    } catch (error) {
      this.quarantinedTemplates = previous;
      throw error;
    }
  }

  public async finalizeSettingsMigration(): Promise<string | null> {
    if (!this.pendingSettingsMigration) return null;
    this.lastSettingsRecoveryPath = null;
    if (this.settingsStore) {
      await this.settingsStore.persistCurrent();
    } else {
      await this.persistSettingsCandidate(this.settings);
    }
    return this.lastSettingsRecoveryPath;
  }

  public protectedSettings(): { raw: unknown; status: string } | null {
    return this.protectedSettingsRaw === null || this.protectedSettingsStatus === null
      ? null
      : { raw: clone(this.protectedSettingsRaw), status: this.protectedSettingsStatus };
  }

  public async exportProtectedSettingsRecovery(): Promise<string> {
    const protectedSettings = this.protectedSettings();
    if (!protectedSettings) throw new Error('There is no protected Templar settings data to export.');
    return this.recovery.backupSettings(protectedSettings.raw, 'manual-replace');
  }

  public async resetProtectedSettingsAfterRecovery(): Promise<string> {
    const protectedSettings = this.protectedSettings();
    if (!protectedSettings) throw new Error('There is no protected Templar settings data to reset.');
    const recoveryPath = await this.recovery.backupSettings(protectedSettings.raw, 'manual-replace');
    await this.saveData(settingsToPersistedData(this.settings, this.quarantinedTemplates));
    this.protectedSettingsRaw = null;
    this.protectedSettingsStatus = null;
    return recoveryPath;
  }

  private async persistSettingsCandidate(value: TemplarSettings): Promise<void> {
    if (this.protectedSettingsRaw !== null) {
      throw new Error('Templar could not safely interpret stored settings. Safe defaults are active and the original data will not be overwritten automatically. Export recovery data and reset settings before saving changes.');
    }
    const data = settingsToPersistedData(value, this.quarantinedTemplates);
    if (this.pendingSettingsMigration) {
      const recoveryPath = await this.recovery.backupSettings(this.pendingSettingsMigrationRaw, 'migration');
      await this.saveData(data);
      this.pendingSettingsMigration = false;
      this.pendingSettingsMigrationRaw = null;
      this.lastSettingsRecoveryPath = recoveryPath;
      return;
    }
    await this.saveData(data);
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
    options: {
      recordRecent?: boolean;
      notify?: boolean;
      appliedByRule?: { id: string; name: string };
      guard?: import('./services/frontmatter').FrontmatterWriteGuard;
    } = {},
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
      guard: options.guard,
    });
    this.refreshSidebars();
    this.updateStatusBar();
    if (options.notify !== false) reportSingleFileOperation(result, `Applied “${template.name}” to ${file.basename}.`);
    else for (const warning of result.warnings) new Notice(warning.message);
  }

  public async removeStyle(file = this.activeFile()): Promise<void> {
    if (!file || !this.frontmatter.hasStyle(file)) {
      new Notice('The active note does not have a page style.');
      return;
    }
    const result = await this.application.removeStyle(file);
    this.refreshSidebars();
    this.updateStatusBar();
    reportSingleFileOperation(result, `Removed Templar styling from ${file.basename}.`);
  }

  public showStylePicker(file = this.activeFile()): void {
    this.ui.showStylePicker(file);
  }

  public showApplyTemplate(template: TemplarTemplate, file = this.activeFile()): void {
    this.ui.showApplyTemplate(template, file);
  }

  public showApplyWithOptions(template: TemplarTemplate, file = this.activeFile()): void {
    this.ui.showApplyWithOptions(template, file);
  }

  public showNewNoteStylePicker(): void {
    this.ui.showNewNoteStylePicker();
  }

  public showCreateStyledNote(template: TemplarTemplate): void {
    this.ui.showCreateStyledNote(template);
  }

  public showPageMode(file = this.activeFile()): void {
    this.ui.showPageMode(file);
  }

  public showTemplateCreator(template?: TemplarTemplate): void {
    this.ui.showTemplateCreator(template);
  }

  public showTemplateImporter(): void {
    this.ui.showTemplateImporter();
  }

  public showPackExporter(templates?: TemplarTemplate[]): void {
    this.ui.showPackExporter(templates);
  }

  public showSynchronizationReview(templateId?: string): void {
    this.ui.showSynchronizationReview(templateId);
  }

  public showStyleRules(): void {
    this.ui.showStyleRules();
  }

  public showRawStyleEditor(file = this.activeFile()): void {
    this.ui.showRawStyleEditor(file);
  }

  public showCurrentNoteInspector(file = this.activeFile()): void {
    this.ui.showCurrentNoteInspector(file);
  }

  public showRecovery(file = this.activeFile()): void {
    this.ui.showRecovery(file);
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
    this.ui.showBatchApply();
  }

  public async openStylesView(): Promise<void> {
    await this.ui.openStylesView();
  }

  public async focusStyleSearch(): Promise<void> {
    await this.ui.focusStyleSearch();
  }

  public async cycleFavouritePreview(direction: 1 | -1): Promise<void> {
    await this.ui.cycleFavouritePreview(direction);
  }

  public async applyCurrentPreview(leaf = this.activeMarkdownLeaf()): Promise<void> {
    const session = leaf ? this.preview.currentForLeaf(leaf) : null;
    if (!session) return;
    await this.preview.cancel(session.owner);
    await this.applyTemplate(noteTemplateSnapshot(session.style), session.file, session.style.page);
  }

  public async copyAuthoringKit(): Promise<void> {
    await this.authoringKit.copy();
  }

  public async exportAuthoringKit(): Promise<void> {
    await this.authoringKit.export();
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
    const result = await this.application.writeStyle(file, style);
    for (const warning of result.warnings) new Notice(warning.message);
    this.refreshSidebars();
    this.updateStatusBar();
  }

  public async evaluateStyleRules(file: TFile, metadataReady: boolean): Promise<void> {
    await this.ruleEngine.evaluate(file, metadataReady);
  }
  public updateStatusBar(): void {
    if (!this.statusBarEl) {
      return;
    }
    const file = this.activeFile();
    const inspection = file ? this.frontmatter.inspect(file) : null;
    const style = inspection?.style ?? null;
    const text = style
      ? `Templar: ${style.name}`
      : inspection?.rawExists ? 'Templar: Recovery required' : '';
    this.statusBarEl.setText(text);
    this.statusBarEl.toggleClass('is-hidden', !text);
  }
}
