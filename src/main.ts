import {
  MarkdownView,
  Menu,
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
import { TemplateLibrary } from './services/template-library';
import { DEFAULT_SETTINGS } from './templates/defaults';
import { TEMPLAR_LLM_AUTHORING_KIT } from './templates/llm-kit';
import { normalizeTemplate } from './templates/schema';
import { templateToExportObject } from './templates/note-format';
import type { NotePageOptions, TemplarSettings, TemplarTemplate } from './types';
import { writeTextToClipboard } from './utils/clipboard';
import { clone, slugify } from './utils/value';
import {
  BatchApplyModal,
  ApplyStyleModal,
  CreateStyledNoteModal,
  PageModeModal,
  RawStyleModal,
  StylePickerModal,
  TemplateCreatorModal,
  TemplateImportModal,
} from './ui/modals';
import { TemplarSettingTab } from './ui/settings-tab';
import { TemplarStylesView } from './ui/styles-view';

export default class TemplarPlugin extends Plugin {
  public settings: TemplarSettings = clone(DEFAULT_SETTINGS);
  public library!: TemplateLibrary;
  public frontmatter!: FrontmatterService;
  public fontMetrics!: FontMetricsService;
  public renderer!: PageRenderer;

  private statusBarEl: HTMLElement | null = null;

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
      this.renderer.scheduleRefreshAll();
      this.updateStatusBar();
    });
  }

  public onunload(): void {
    this.renderer.destroy();
  }

  public async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<TemplarSettings> | null;
    const userTemplates = Array.isArray(data?.userTemplates)
      ? data.userTemplates.map((template) => normalizeTemplate(template))
      : [];
    this.settings = {
      ...clone(DEFAULT_SETTINGS),
      ...(data ?? {}),
      userTemplates,
    };
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

  public async applyTemplate(
    template: TemplarTemplate,
    file = this.activeFile(),
    pageOptions?: NotePageOptions,
  ): Promise<void> {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    const resolvedPageOptions =
      pageOptions ?? this.frontmatter.getStyle(file)?.page;
    await this.frontmatter.applyTemplate(file, template, resolvedPageOptions);
    await this.renderer.refreshFile(file);
    this.refreshSidebars();
    this.updateStatusBar();
    new Notice(`Applied “${template.name}” to ${file.basename}.`);
  }

  public async removeStyle(file = this.activeFile()): Promise<void> {
    if (!file || !this.frontmatter.hasStyle(file)) {
      new Notice('The active note does not have a page style.');
      return;
    }
    await this.frontmatter.removeStyle(file);
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
    new RawStyleModal(this, file, style).open();
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
        this.renderer.scheduleRefreshAll();
        this.refreshSidebars();
        this.updateStatusBar();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('file-open', () => {
        this.renderer.scheduleRefreshAll();
        this.updateStatusBar();
      }),
    );
    this.registerEvent(
      this.app.workspace.on('layout-change', () => this.renderer.scheduleRefreshAll()),
    );
    this.registerEvent(
      this.app.metadataCache.on('changed', (file) => {
        this.frontmatter.settle(file);
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
          this.frontmatter.rename(oldPath, file.path);
        }
        this.renderer.scheduleRefreshAll();
      }),
    );
    this.registerEvent(
      this.app.vault.on('delete', (file) => {
        this.frontmatter.forget(file.path);
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
