import {
  FuzzySuggestModal,
  Modal,
  Notice,
  Setting,
  TFile,
  TFolder,
  getAllTags,
  normalizePath,
  parseYaml,
  stringifyYaml,
  type DropdownComponent,
  type TextComponent,
} from 'obsidian';
import type TemplarPlugin from '../main';
import { validateCustomCss } from '../services/css-validator';
import { DEFAULT_TEMPLATE } from '../templates/defaults';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import {
  noteStyleToFrontmatter,
  parsedObjectToTemplate,
  templateToExportObject,
} from '../templates/note-format';
import {
  normalizeNoteStyle,
  normalizeTemplate,
  validateTemplate,
  validateTemplateSource,
} from '../templates/schema';
import type {
  BaselineMode,
  ImageFrame,
  NotePageOptions,
  TemplarNoteStyle,
  TemplarTemplate,
  PaperPattern,
  ValidationIssue,
} from '../types';
import { writeTextToClipboard } from '../utils/clipboard';
import { clone, slugify } from '../utils/value';
import { renderIssues } from './issues';
import { renderTemplatePreview } from './template-preview';

export class StylePickerModal extends FuzzySuggestModal<TemplarTemplate> {
  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile | null,
    private readonly intent: 'apply' | 'create' = 'apply',
  ) {
    super(plugin.app);
    this.setPlaceholder('Choose a page style…');
  }

  public getItems(): TemplarTemplate[] {
    return this.plugin.library.all();
  }

  public getItemText(item: TemplarTemplate): string {
    return `${item.name} — ${item.metadata.description}`;
  }

  public onChooseItem(item: TemplarTemplate): void {
    if (this.intent === 'create') {
      new CreateStyledNoteModal(this.plugin, item).open();
    } else if (this.file) {
      new ApplyStyleModal(this.plugin, this.file, item).open();
    }
  }
}

export class ApplyStyleModal extends Modal {
  private pageOptions: NotePageOptions;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly template: TemplarTemplate,
  ) {
    super(plugin.app);
    this.pageOptions = clone(
      plugin.frontmatter.getStyle(file)?.page ?? DEFAULT_PAGE_OPTIONS,
    );
  }

  public onOpen(): void {
    this.setTitle(`Apply “${this.template.name}”`);
    this.contentEl.createEl('p', {
      text: 'Choose how this note should flow. This choice belongs to the note and can be changed later.',
    });
    renderPageOptionSettings(this.contentEl, this.pageOptions, () => undefined);
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply style' });
    apply.addEventListener('click', () => void runButtonAction(apply, async () => {
      await this.plugin.applyTemplate(this.template, this.file, this.pageOptions);
      this.close();
    }));
  }
}

export class PageModeModal extends Modal {
  private pageOptions: NotePageOptions;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly style: TemplarNoteStyle,
  ) {
    super(plugin.app);
    this.pageOptions = clone(style.page);
  }

  public onOpen(): void {
    this.setTitle('Page mode');
    this.contentEl.createEl('p', {
      text: 'Pageless mode reflows with the window. Paged mode keeps a fixed layout and scales each sheet as a whole on narrow screens.',
    });
    renderPageOptionSettings(this.contentEl, this.pageOptions, () => undefined);
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save page mode' });
    save.addEventListener('click', () => void runButtonAction(save, async () => this.save()));
  }

  private async save(): Promise<void> {
    await this.plugin.frontmatter.patchPageOptions(this.file, this.pageOptions);
    await this.plugin.renderer.refreshFile(this.file);
    this.plugin.refreshSidebars();
    this.plugin.updateStatusBar();
    new Notice(`Changed ${this.file.basename} to ${this.pageOptions.mode} mode.`);
    this.close();
  }
}

export class CreateStyledNoteModal extends Modal {
  private pageOptions = clone(DEFAULT_PAGE_OPTIONS);
  private title = 'Untitled Templar note';
  private folder: string;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly template: TemplarTemplate,
  ) {
    super(plugin.app);
    this.folder = plugin.activeFile()?.parent?.path ?? '';
  }

  public onOpen(): void {
    this.setTitle(`New note — ${this.template.name}`);
    new Setting(this.contentEl)
      .setName('Note title')
      .addText((text) =>
        text.setValue(this.title).onChange((value) => {
          this.title = value.trim();
        }),
      );
    new Setting(this.contentEl)
      .setName('Folder')
      .setDesc('Vault-relative. A missing folder will be created.')
      .addText((text) =>
        text.setValue(this.folder).onChange((value) => {
          this.folder = value.trim();
        }),
      );
    renderPageOptionSettings(this.contentEl, this.pageOptions, () => undefined);
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const create = actions.createEl('button', { cls: 'mod-cta', text: 'Create styled note' });
    create.addEventListener('click', () => void runButtonAction(create, async () => this.createNote()));
  }

  private async createNote(): Promise<void> {
    const safeTitle = (this.title || 'Untitled Templar note').replace(/[\\/:*?"<>|]/g, '-');
    const folder = normalizePath(this.folder);
    if (folder) {
      const existing = this.app.vault.getAbstractFileByPath(folder);
      if (existing && !(existing instanceof TFolder)) {
        throw new Error(`“${folder}” is a file, not a folder.`);
      }
      if (!existing) {
        await createFolderTree(this.plugin, folder);
      }
    }
    const base = normalizePath(folder ? `${folder}/${safeTitle}` : safeTitle);
    let path = `${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${base} ${String(suffix)}.md`;
      suffix += 1;
    }
    const file = await this.app.vault.create(path, '');
    await this.plugin.frontmatter.applyTemplate(file, this.template, this.pageOptions);
    await this.app.workspace.getLeaf(false).openFile(file);
    this.plugin.renderer.scheduleRefreshAll();
    this.plugin.refreshSidebars();
    new Notice(`Created ${file.path}.`);
    this.close();
  }
}

export class TemplateImportModal extends Modal {
  private importedTemplate: TemplarTemplate | null = null;
  private inputEl!: HTMLTextAreaElement;
  private validationEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private saveButton!: HTMLButtonElement;
  private validationVersion = 0;

  public constructor(private readonly plugin: TemplarPlugin) {
    super(plugin.app);
  }

  public onOpen(): void {
    this.setTitle('Import page style');
    this.modalEl.addClass('templar-modal', 'templar-import-modal');
    this.contentEl.createEl('p', {
      text: 'Paste a .templar document or YAML generated with the authoring skill. Nothing is saved until validation passes.',
    });
    this.inputEl = this.contentEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: {
        rows: '18',
      },
    });
    this.validationEl = this.contentEl.createDiv();
    this.previewEl = this.contentEl.createDiv({ cls: 'templar-preview-container' });

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const validateButton = actions.createEl('button', { text: 'Validate and preview' });
    validateButton.addEventListener('click', () => void this.validateInput());
    this.saveButton = actions.createEl('button', {
      cls: 'mod-cta',
      text: 'Save to library',
    });
    this.saveButton.disabled = true;
    this.saveButton.addEventListener('click', () =>
      void runButtonAction(this.saveButton, async () => this.save()),
    );
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private async validateInput(): Promise<void> {
    const version = ++this.validationVersion;
    this.importedTemplate = null;
    this.saveButton.disabled = true;
    this.previewEl.empty();
    try {
      const parsed = parseYaml(stripCodeFence(this.inputEl.value)) as unknown;
      const template = parsedObjectToTemplate(parsed);
      template.builtIn = false;
      const issues = [
        ...validateTemplateSource(parsed),
        ...validateCompleteTemplate(template),
      ];
      renderIssues(this.validationEl, issues);
      if (issues.some((issue) => issue.severity === 'error')) {
        return;
      }
      this.importedTemplate = template;
      this.saveButton.disabled = false;
      const staging = this.previewEl.ownerDocument.createElement('div');
      await renderTemplatePreview(staging, template, this.plugin.fontMetrics);
      if (version !== this.validationVersion) {
        return;
      }
      this.previewEl.empty();
      this.previewEl.append(...Array.from(staging.childNodes));
    } catch (error) {
      if (version !== this.validationVersion) {
        return;
      }
      renderIssues(this.validationEl, [
        {
          severity: 'error',
          path: 'yaml',
          message: error instanceof Error ? error.message : String(error),
          fix: 'Paste one complete YAML document without commentary around it.',
        },
      ]);
    }
  }

  private async save(): Promise<void> {
    if (!this.importedTemplate) {
      return;
    }
    try {
      const saved = await this.plugin.library.saveAsNew(this.importedTemplate);
      this.plugin.refreshSidebars();
      new Notice(`Imported “${saved.name}”.`);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }
}

export class RawStyleModal extends Modal {
  private inputEl!: HTMLTextAreaElement;
  private validationEl!: HTMLElement;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly style: TemplarNoteStyle,
  ) {
    super(plugin.app);
  }

  public onOpen(): void {
    this.setTitle(`Raw Page Style — ${this.file.basename}`);
    this.modalEl.addClass('templar-modal', 'templar-raw-modal');
    this.contentEl.createEl('p', {
      text: 'This edits only the templar property. The Markdown body and all other frontmatter are preserved.',
    });
    this.inputEl = this.contentEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: { rows: '24' },
    });
    this.inputEl.value = stringifyYaml({ templar: noteStyleToFrontmatter(this.style) });
    this.validationEl = this.contentEl.createDiv();

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const validateButton = actions.createEl('button', { text: 'Validate' });
    validateButton.addEventListener('click', () => this.readAndValidate());
    const saveButton = actions.createEl('button', { cls: 'mod-cta', text: 'Save style' });
    saveButton.addEventListener('click', () =>
      void runButtonAction(saveButton, async () => this.save()),
    );
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private readAndValidate(): TemplarNoteStyle | null {
    try {
      const parsed = parseYaml(stripCodeFence(this.inputEl.value)) as unknown;
      const root =
        typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
          ? (parsed as Record<string, unknown>)
          : {};
      const style = normalizeNoteStyle(root.templar ?? root);
      if (!style) {
        throw new Error('Add a templar mapping to the YAML document.');
      }
      const issues = [
        ...validateTemplateSource(root.templar ?? root, { requirePage: true }),
        ...validateCompleteTemplate(style),
      ];
      renderIssues(this.validationEl, issues);
      return issues.some((issue) => issue.severity === 'error') ? null : style;
    } catch (error) {
      renderIssues(this.validationEl, [
        {
          severity: 'error',
          path: 'yaml',
          message: error instanceof Error ? error.message : String(error),
        },
      ]);
      return null;
    }
  }

  private async save(): Promise<void> {
    const style = this.readAndValidate();
    if (!style) {
      return;
    }
    await this.plugin.frontmatter.writeStyle(this.file, style);
    await this.plugin.renderer.refreshFile(this.file);
    this.plugin.refreshSidebars();
    this.plugin.updateStatusBar();
    new Notice('Saved the note’s page style.');
    this.close();
  }
}

export class TemplateCreatorModal extends Modal {
  private draft: TemplarTemplate;
  private readonly originalId: string | null;
  private editorEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private issuesEl!: HTMLElement;
  private generatedOutputEl: HTMLTextAreaElement | null = null;
  private mode: 'simple' | 'detailed' | 'advanced' = 'simple';
  private previewPage = clone(DEFAULT_PAGE_OPTIONS);
  private previewVersion = 0;

  public constructor(
    private readonly plugin: TemplarPlugin,
    template?: TemplarTemplate,
  ) {
    super(plugin.app);
    this.draft = clone(template ?? DEFAULT_TEMPLATE);
    this.originalId = template && !template.builtIn ? template.id : null;
    this.draft.builtIn = false;
    if (!template) {
      this.draft.id = `custom-style-${String(Date.now())}`;
      this.draft.name = 'My Page Style';
      this.draft.baseline.unit = plugin.settings.defaultGridUnit;
    }
  }

  public onOpen(): void {
    this.setTitle('Template creator');
    this.modalEl.addClass('templar-modal', 'templar-creator-modal');
    const tabs = this.contentEl.createDiv({ cls: 'templar-tabs' });
    const simple = tabs.createEl('button', { text: 'Simple mode' });
    const detailed = tabs.createEl('button', { text: 'Detailed mode' });
    const advanced = tabs.createEl('button', { text: 'Advanced mode' });
    simple.addEventListener('click', () => {
      this.mode = 'simple';
      this.renderEditor();
    });
    detailed.addEventListener('click', () => {
      this.mode = 'detailed';
      this.renderEditor();
    });
    advanced.addEventListener('click', () => {
      this.mode = 'advanced';
      this.renderEditor();
    });

    const workspace = this.contentEl.createDiv({ cls: 'templar-creator-workspace' });
    this.editorEl = workspace.createDiv({ cls: 'templar-creator-editor' });
    const previewColumn = workspace.createDiv({ cls: 'templar-creator-preview' });
    previewColumn.createDiv({ cls: 'templar-section-label', text: 'Live preview' });
    const previewMode = previewColumn.createEl('button', {
      cls: 'templar-preview-mode',
      text: 'Preview paged',
    });
    previewMode.addEventListener('click', () => {
      this.previewPage.mode = this.previewPage.mode === 'paged' ? 'pageless' : 'paged';
      previewMode.setText(
        this.previewPage.mode === 'paged' ? 'Preview pageless' : 'Preview paged',
      );
      void this.updatePreview();
    });
    this.previewEl = previewColumn.createDiv({ cls: 'templar-preview-container' });
    this.issuesEl = previewColumn.createDiv();

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const exportButton = actions.createEl('button', { text: 'Copy YAML' });
    exportButton.addEventListener('click', () =>
      void runButtonAction(exportButton, async () => this.copyYaml()),
    );
    const saveButton = actions.createEl('button', {
      cls: 'mod-cta',
      text: 'Save to library',
    });
    saveButton.addEventListener('click', () => void runButtonAction(saveButton, async () => this.save()));
    this.renderEditor();
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private renderEditor(): void {
    this.editorEl.empty();
    this.generatedOutputEl = null;
    if (this.mode === 'advanced') {
      this.renderAdvancedEditor();
    } else if (this.mode === 'detailed') {
      this.renderDetailedEditor();
    } else {
      this.renderSimpleEditor();
    }
    void this.updatePreview();
  }

  private renderDetailedEditor(): void {
    this.heading('Identity and metadata');
    this.textSetting('Name', 'Shown in the Page Style library.', this.draft.name, (value) => {
      this.draft.name = value;
      if (!this.originalId) {
        this.draft.id = slugify(value);
      }
    });
    this.textSetting('Description', 'Explain the intended aesthetic.', this.draft.metadata.description, (value) => {
      this.draft.metadata.description = value;
    });
    this.textSetting('Author', 'Stored in exported template metadata.', this.draft.metadata.author, (value) => {
      this.draft.metadata.author = value;
    });
    this.textSetting('Tags', 'Comma-separated library tags.', this.draft.metadata.tags.join(', '), (value) => {
      this.draft.metadata.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
    });

    this.heading('Paper and pattern');
    this.colorSetting('Paper background', this.draft.paper.color, (value) => {
      this.draft.paper.color = value;
    });
    new Setting(this.editorEl).setName('Pattern').addDropdown((dropdown) =>
      dropdown
        .addOptions({ blank: 'Blank', ruled: 'Ruled', 'dot-grid': 'Dot grid', graph: 'Graph' })
        .setValue(this.draft.paper.pattern)
        .onChange((value) => {
          this.draft.paper.pattern = value as PaperPattern;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Minor pattern color', this.draft.paper.patternColor, (value) => {
      this.draft.paper.patternColor = value;
    });
    this.colorSetting('Major graph color', this.draft.paper.majorPatternColor, (value) => {
      this.draft.paper.majorPatternColor = value;
    });
    this.toggleSetting('Margin line', this.draft.paper.marginLine, (value) => {
      this.draft.paper.marginLine = value;
    });
    this.colorSetting('Margin color', this.draft.paper.marginColor, (value) => {
      this.draft.paper.marginColor = value;
    });
    this.sliderSetting('Margin offset', this.draft.paper.marginOffset, 0, 220, 2, (value) => {
      this.draft.paper.marginOffset = value;
    });

    this.heading('Body typography and rhythm');
    this.textSetting('Body font', 'Use a complete fallback stack.', this.draft.typography.bodyFont, (value) => {
      this.draft.typography.bodyFont = value;
    });
    this.sliderSetting('Body size', this.draft.typography.bodySize, 8, 48, 1, (value) => {
      this.draft.typography.bodySize = value;
    });
    this.sliderSetting('Body weight', this.draft.typography.bodyWeight, 100, 900, 50, (value) => {
      this.draft.typography.bodyWeight = value;
    });
    this.colorSetting('Text color', this.draft.typography.textColor, (value) => {
      this.draft.typography.textColor = value;
    });
    this.colorSetting('Muted text color', this.draft.typography.mutedColor, (value) => {
      this.draft.typography.mutedColor = value;
    });
    this.sliderSetting('Vertical rhythm', this.draft.baseline.unit, 12, 96, 1, (value) => {
      this.draft.baseline.unit = value;
    });
    new Setting(this.editorEl).setName('Grid mode').addDropdown((dropdown) =>
      dropdown
        .addOptions({ strict: 'Strict', balanced: 'Balanced', free: 'Free' })
        .setValue(this.draft.baseline.mode)
        .onChange((value) => {
          this.draft.baseline.mode = value as BaselineMode;
          this.draft.baseline.enabled = value !== 'free';
          void this.updatePreview();
        }),
    );
    this.toggleSetting('Snap images to rhythm', this.draft.baseline.snapImages, (value) => {
      this.draft.baseline.snapImages = value;
    });

    this.heading('Heading typography');
    this.headingLevelSettings('h1', 'Heading 1');
    this.headingLevelSettings('h2', 'Heading 2');
    this.headingLevelSettings('h3', 'Heading 3');
    this.headingLevelSettings('h4', 'Heading 4');

    this.heading('Page geometry');
    this.sliderSetting('Maximum width', this.draft.layout.maxWidth, 320, 1800, 10, (value) => {
      this.draft.layout.maxWidth = value;
    });
    this.sliderSetting('Top padding', this.draft.layout.paddingTop, 0, 200, 2, (value) => {
      this.draft.layout.paddingTop = value;
    });
    this.sliderSetting('Right padding', this.draft.layout.paddingRight, 0, 180, 2, (value) => {
      this.draft.layout.paddingRight = value;
    });
    this.sliderSetting('Bottom padding', this.draft.layout.paddingBottom, 0, 300, 2, (value) => {
      this.draft.layout.paddingBottom = value;
    });
    this.sliderSetting('Left padding', this.draft.layout.paddingLeft, 0, 180, 2, (value) => {
      this.draft.layout.paddingLeft = value;
    });
    this.sliderSetting('Page corner radius', this.draft.layout.pageRadius, 0, 40, 1, (value) => {
      this.draft.layout.pageRadius = value;
    });
    this.textSetting('Page shadow', 'A self-contained CSS box-shadow value.', this.draft.layout.pageShadow, (value) => {
      this.draft.layout.pageShadow = value;
    });

    this.heading('Images');
    new Setting(this.editorEl).setName('Frame style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', thin: 'Thin', photo: 'Photo', polaroid: 'Polaroid', scrapbook: 'Scrapbook', rounded: 'Rounded', technical: 'Technical', dark: 'Dark', vintage: 'Vintage' })
        .setValue(this.draft.images.frame)
        .onChange((value) => {
          this.draft.images.frame = value as ImageFrame;
          void this.updatePreview();
        }),
    );
    this.sliderSetting('Border width', this.draft.images.borderWidth, 0, 40, 1, (value) => {
      this.draft.images.borderWidth = value;
    });
    this.sliderSetting('Bottom border width', this.draft.images.bottomBorderWidth, 0, 80, 1, (value) => {
      this.draft.images.bottomBorderWidth = value;
    });
    this.colorSetting('Border color', this.draft.images.borderColor, (value) => {
      this.draft.images.borderColor = value;
    });
    this.sliderSetting('Corner radius', this.draft.images.cornerRadius, 0, 60, 1, (value) => {
      this.draft.images.cornerRadius = value;
    });
    this.sliderSetting('Rotation', this.draft.images.rotation, -15, 15, 0.5, (value) => {
      this.draft.images.rotation = value;
    });
    this.textSetting('Image shadow', 'A self-contained CSS box-shadow value.', this.draft.images.shadow, (value) => {
      this.draft.images.shadow = value;
    });
    this.sliderSetting('Maximum width', this.draft.images.maxWidth, 10, 100, 1, (value) => {
      this.draft.images.maxWidth = value;
    });
    this.sliderSetting('Top spacing', this.draft.images.topSpacing, 0, 120, 1, (value) => {
      this.draft.images.topSpacing = value;
    });
    this.sliderSetting('Bottom spacing', this.draft.images.bottomSpacing, 0, 120, 1, (value) => {
      this.draft.images.bottomSpacing = value;
    });
    this.sliderSetting('Opacity', this.draft.images.opacity, 0, 1, 0.05, (value) => {
      this.draft.images.opacity = value;
    });
    this.sliderSetting('Sepia', this.draft.images.sepia, 0, 1, 0.05, (value) => {
      this.draft.images.sepia = value;
    });
    this.sliderSetting('Grayscale', this.draft.images.grayscale, 0, 1, 0.05, (value) => {
      this.draft.images.grayscale = value;
    });
    this.sliderSetting('Saturation', this.draft.images.saturation, 0, 2, 0.05, (value) => {
      this.draft.images.saturation = value;
    });
    this.sliderSetting('Contrast', this.draft.images.contrast, 0, 2, 0.05, (value) => {
      this.draft.images.contrast = value;
    });

    this.heading('Links, highlights, quotes, code, tables, and tasks');
    this.colorSetting('Link color', this.draft.blocks.linkColor, (value) => {
      this.draft.blocks.linkColor = value;
    });
    this.colorSetting('Highlight background', this.draft.blocks.highlightBackground, (value) => {
      this.draft.blocks.highlightBackground = value;
    });
    this.colorSetting('Highlighted text', this.draft.blocks.highlightTextColor, (value) => {
      this.draft.blocks.highlightTextColor = value;
    });
    this.colorSetting('Quote accent', this.draft.blocks.quoteAccent, (value) => {
      this.draft.blocks.quoteAccent = value;
    });
    this.colorSetting('Quote background', this.draft.blocks.quoteBackground, (value) => {
      this.draft.blocks.quoteBackground = value;
    });
    this.colorSetting('Quote text', this.draft.blocks.quoteTextColor, (value) => {
      this.draft.blocks.quoteTextColor = value;
    });
    this.colorSetting('Code background', this.draft.blocks.codeBackground, (value) => {
      this.draft.blocks.codeBackground = value;
    });
    this.colorSetting('Code text', this.draft.blocks.codeTextColor, (value) => {
      this.draft.blocks.codeTextColor = value;
    });
    this.textSetting('Code font', 'Use a complete monospace fallback stack.', this.draft.blocks.codeFont, (value) => {
      this.draft.blocks.codeFont = value;
    });
    this.sliderSetting('Code size', this.draft.blocks.codeSize, 8, 32, 1, (value) => {
      this.draft.blocks.codeSize = value;
    });
    this.colorSetting('Table borders', this.draft.blocks.tableBorder, (value) => {
      this.draft.blocks.tableBorder = value;
    });
    this.colorSetting('Table header background', this.draft.blocks.tableHeaderBackground, (value) => {
      this.draft.blocks.tableHeaderBackground = value;
    });
    this.colorSetting('Checkbox accent', this.draft.blocks.checkboxAccent, (value) => {
      this.draft.blocks.checkboxAccent = value;
    });
  }

  private headingLevelSettings(
    level: 'h1' | 'h2' | 'h3' | 'h4',
    label: string,
  ): void {
    const heading = this.draft.headings[level];
    this.textSetting(`${label} font`, 'Use a complete fallback stack.', heading.font, (value) => {
      this.draft.headings[level].font = value;
    });
    this.sliderSetting(`${label} size`, heading.size, 8, 100, 1, (value) => {
      this.draft.headings[level].size = value;
    });
    this.sliderSetting(`${label} weight`, heading.weight, 100, 900, 50, (value) => {
      this.draft.headings[level].weight = value;
    });
    this.colorSetting(`${label} color`, heading.color, (value) => {
      this.draft.headings[level].color = value;
    });
    new Setting(this.editorEl).setName(`${label} decoration`).addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', underline: 'Underline', rule: 'Rule', highlight: 'Highlight' })
        .setValue(heading.decoration)
        .onChange((value) => {
          this.draft.headings[level].decoration = value as typeof heading.decoration;
          void this.updatePreview();
        }),
    );
  }

  private toggleSetting(
    name: string,
    value: boolean,
    update: (value: boolean) => void,
  ): void {
    new Setting(this.editorEl).setName(name).addToggle((toggle) =>
      toggle.setValue(value).onChange((next) => {
        update(next);
        void this.updatePreview();
      }),
    );
  }

  private renderSimpleEditor(): void {
    this.heading('Identity');
    this.textSetting('Name', 'Shown in the Page Style library.', this.draft.name, (value) => {
      this.draft.name = value;
      if (!this.originalId) {
        this.draft.id = slugify(value);
      }
    });
    this.textSetting(
      'Description',
      'A short explanation of the visual design.',
      this.draft.metadata.description,
      (value) => {
        this.draft.metadata.description = value;
      },
    );

    this.heading('Paper');
    this.colorSetting('Background', this.draft.paper.color, (value) => {
      this.draft.paper.color = value;
    });
    new Setting(this.editorEl)
      .setName('Pattern')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ blank: 'Blank', ruled: 'Ruled', 'dot-grid': 'Dot grid', graph: 'Graph' })
          .setValue(this.draft.paper.pattern)
          .onChange((value) => {
            this.draft.paper.pattern = value as PaperPattern;
            void this.updatePreview();
          }),
      );
    this.colorSetting('Pattern color', this.draft.paper.patternColor, (value) => {
      this.draft.paper.patternColor = value;
    });
    new Setting(this.editorEl)
      .setName('Margin line')
      .addToggle((toggle) =>
        toggle.setValue(this.draft.paper.marginLine).onChange((value) => {
          this.draft.paper.marginLine = value;
          void this.updatePreview();
        }),
      );

    this.heading('Typography and baseline');
    this.textSetting('Body font', 'Include fallback fonts.', this.draft.typography.bodyFont, (value) => {
      this.draft.typography.bodyFont = value;
    });
    this.sliderSetting('Font size', this.draft.typography.bodySize, 10, 40, 1, (value) => {
      this.draft.typography.bodySize = value;
    });
    this.sliderSetting('Vertical rhythm', this.draft.baseline.unit, 16, 60, 1, (value) => {
      this.draft.baseline.unit = value;
    });
    new Setting(this.editorEl)
      .setName('Grid alignment')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ strict: 'Strict', balanced: 'Balanced', free: 'Free' })
          .setValue(this.draft.baseline.mode)
          .onChange((value) => {
            this.draft.baseline.mode = value as BaselineMode;
            this.draft.baseline.enabled = value !== 'free';
            void this.updatePreview();
          }),
      );
    this.colorSetting('Text color', this.draft.typography.textColor, (value) => {
      this.draft.typography.textColor = value;
    });

    this.heading('Headings');
    this.sliderSetting('H1 size', this.draft.headings.h1.size, 20, 80, 1, (value) => {
      this.draft.headings.h1.size = value;
    });
    this.colorSetting('H1 color', this.draft.headings.h1.color, (value) => {
      this.draft.headings.h1.color = value;
    });

    this.heading('Layout');
    this.sliderSetting('Page width', this.draft.layout.maxWidth, 480, 1400, 20, (value) => {
      this.draft.layout.maxWidth = value;
    });
    this.sliderSetting('Left padding', this.draft.layout.paddingLeft, 0, 180, 4, (value) => {
      this.draft.layout.paddingLeft = value;
    });
    this.sliderSetting('Right padding', this.draft.layout.paddingRight, 0, 180, 4, (value) => {
      this.draft.layout.paddingRight = value;
    });

    this.heading('Images');
    new Setting(this.editorEl)
      .setName('Frame')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            none: 'None',
            thin: 'Thin border',
            photo: 'Photograph',
            polaroid: 'Polaroid',
            scrapbook: 'Scrapbook',
            rounded: 'Rounded',
            technical: 'Technical',
            dark: 'Dark frame',
            vintage: 'Vintage',
          })
          .setValue(this.draft.images.frame)
          .onChange((value) => {
            this.draft.images.frame = value as ImageFrame;
            applyFramePreset(this.draft, this.draft.images.frame);
            void this.updatePreview();
          }),
      );
    this.sliderSetting('Rotation', this.draft.images.rotation, -8, 8, 0.5, (value) => {
      this.draft.images.rotation = value;
    });
    this.sliderSetting('Corner radius', this.draft.images.cornerRadius, 0, 40, 1, (value) => {
      this.draft.images.cornerRadius = value;
    });

    this.heading('Blocks');
    this.colorSetting('Link color', this.draft.blocks.linkColor, (value) => {
      this.draft.blocks.linkColor = value;
    });
    this.colorSetting('Quote accent', this.draft.blocks.quoteAccent, (value) => {
      this.draft.blocks.quoteAccent = value;
    });
    this.colorSetting('Checkbox accent', this.draft.blocks.checkboxAccent, (value) => {
      this.draft.blocks.checkboxAccent = value;
    });
    this.colorSetting(
      'Highlight background',
      this.draft.blocks.highlightBackground,
      (value) => {
        this.draft.blocks.highlightBackground = value;
      },
    );
    this.colorSetting(
      'Highlighted text',
      this.draft.blocks.highlightTextColor,
      (value) => {
        this.draft.blocks.highlightTextColor = value;
      },
    );
  }

  private renderAdvancedEditor(): void {
    this.heading('Advanced CSS');
    this.editorEl.createEl('p', {
      text: 'Every selector must begin with .page or .page-content. Imported URLs and global Obsidian selectors are rejected.',
    });
    const css = this.editorEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: { rows: '20' },
    });
    css.value = this.draft.css;
    css.addEventListener('input', () => {
      this.draft.css = css.value;
      void this.updatePreview();
    });
    this.heading('Generated template');
    this.generatedOutputEl = this.editorEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: { rows: '18', readonly: 'true' },
    });
    this.generatedOutputEl.value = stringifyYaml(templateToExportObject(this.draft));
  }

  private heading(text: string): void {
    new Setting(this.editorEl).setName(text).setHeading();
  }

  private textSetting(
    name: string,
    description: string,
    value: string,
    update: (value: string) => void,
  ): void {
    new Setting(this.editorEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(value).onChange((next) => {
          update(next);
          void this.updatePreview();
        }),
      );
  }

  private colorSetting(name: string, value: string, update: (value: string) => void): void {
    const setting = new Setting(this.editorEl).setName(name);
    let textInput: HTMLInputElement | null = null;
    setting.addText((text) => {
      textInput = text.inputEl;
      text.setValue(value).onChange((next) => {
        update(next);
        void this.updatePreview();
      });
    });
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      setting.addColorPicker((picker) =>
        picker.setValue(value).onChange((next) => {
          if (textInput) {
            textInput.value = next;
          }
          update(next);
          void this.updatePreview();
        }),
      );
    }
  }

  private sliderSetting(
    name: string,
    value: number,
    minimum: number,
    maximum: number,
    step: number,
    update: (value: number) => void,
  ): void {
    new Setting(this.editorEl)
      .setName(name)
      .setDesc(String(value))
      .addSlider((slider) =>
        slider
          .setLimits(minimum, maximum, step)
          .setValue(value)
          .onChange((next) => {
            update(next);
            void this.updatePreview();
          }),
      );
  }

  private async updatePreview(): Promise<void> {
    const version = ++this.previewVersion;
    const normalized = normalizeTemplate(this.draft);
    normalized.id = this.originalId ?? slugify(this.draft.name);
    normalized.name = this.draft.name;
    normalized.metadata = clone(this.draft.metadata);
    normalized.css = this.draft.css;
    this.draft = normalized;
    const issues = validateCompleteTemplate(this.draft);
    renderIssues(this.issuesEl, issues);
    if (this.generatedOutputEl) {
      this.generatedOutputEl.value = stringifyYaml(templateToExportObject(this.draft));
    }
    const staging = this.previewEl.ownerDocument.createElement('div');
    await renderTemplatePreview(
      staging,
      this.draft,
      this.plugin.fontMetrics,
      this.previewPage,
    );
    if (version !== this.previewVersion) {
      return;
    }
    this.previewEl.empty();
    this.previewEl.append(...Array.from(staging.childNodes));
  }

  private async copyYaml(): Promise<void> {
    await writeTextToClipboard(
      stringifyYaml(templateToExportObject(this.draft)),
      this.contentEl.ownerDocument,
    );
    new Notice('Template YAML copied.');
  }

  private async save(): Promise<void> {
    const issues = validateCompleteTemplate(this.draft);
    renderIssues(this.issuesEl, issues);
    if (issues.some((issue) => issue.severity === 'error')) {
      new Notice('Fix the template problems before saving.');
      return;
    }
    const saved = this.originalId
      ? await this.plugin.library.save(this.draft)
      : await this.plugin.library.saveAsNew(this.draft);
    this.plugin.refreshSidebars();
    new Notice(`Saved “${saved.name}”.`);
    this.close();
  }
}

export class BatchApplyModal extends Modal {
  private templateId: string;
  private targetScope: 'note' | 'folder' | 'tag' | 'vault' = 'folder';
  private pageMode: 'preserve' | 'pageless' | 'paged' = 'preserve';
  private pageSize: 'a4' | 'letter' = 'a4';
  private tag = '';
  private summaryEl!: HTMLElement;

  public constructor(private readonly plugin: TemplarPlugin) {
    super(plugin.app);
    this.templateId = plugin.settings.defaultTemplateId;
  }

  public onOpen(): void {
    this.setTitle('Apply page style to multiple notes');
    this.modalEl.addClass('templar-modal');
    this.contentEl.createEl('p', {
      text: 'Only the templar frontmatter property will be added or replaced. Markdown bodies and other properties are preserved.',
    });
    const templates: Record<string, string> = {};
    for (const template of this.plugin.library.all()) {
      templates[template.id] = template.name;
    }
    new Setting(this.contentEl)
      .setName('Page style')
      .addDropdown((dropdown) =>
        dropdown.addOptions(templates).setValue(this.templateId).onChange((value) => {
          this.templateId = value;
          this.updateSummary();
        }),
      );
    new Setting(this.contentEl)
      .setName('Apply to')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            note: 'Current note',
            folder: 'Current folder (recursive)',
            tag: 'Notes with tag',
            vault: 'Entire vault',
          })
          .setValue(this.targetScope)
          .onChange((value) => {
            this.targetScope = value as typeof this.targetScope;
            this.updateSummary();
          }),
      );
    new Setting(this.contentEl)
      .setName('Page mode')
      .setDesc('Preserve keeps each styled note’s current mode and uses pageless for unstyled notes.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ preserve: 'Preserve per note', pageless: 'Pageless', paged: 'Paged' })
          .setValue(this.pageMode)
          .onChange((value) => {
            this.pageMode = value as typeof this.pageMode;
          }),
      );
    new Setting(this.contentEl)
      .setName('Paged size')
      .setDesc('Used when page mode is set to paged.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ a4: 'A4', letter: 'US Letter' })
          .setValue(this.pageSize)
          .onChange((value) => {
            this.pageSize = value as typeof this.pageSize;
          }),
      );
    new Setting(this.contentEl)
      .setName('Tag')
      .setDesc('Used only for the “notes with tag” scope. Include or omit #.')
      .addText((text) =>
        text.setValue(this.tag).onChange((value) => {
          this.tag = value.trim();
          this.updateSummary();
        }),
      );
    this.summaryEl = this.contentEl.createDiv({ cls: 'templar-batch-summary' });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const apply = actions.createEl('button', { cls: 'mod-warning', text: 'Review and apply…' });
    apply.addEventListener('click', () => this.confirm());
    this.updateSummary();
  }

  private matchingFiles(): TFile[] {
    const active = this.plugin.activeFile();
    const files = this.app.vault.getMarkdownFiles();
    if (this.targetScope === 'note') {
      return active ? [active] : [];
    }
    if (this.targetScope === 'folder') {
      if (!active) {
        return [];
      }
      const folder = active.parent?.path ?? '';
      return folder ? files.filter((file) => file.path.startsWith(`${folder}/`)) : files;
    }
    if (this.targetScope === 'tag') {
      const wanted = this.tag.replace(/^#/, '');
      if (!wanted) {
        return [];
      }
      return files.filter((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        const tags = cache ? getAllTags(cache) : null;
        return tags?.some((tag) => tag.replace(/^#/, '') === wanted) ?? false;
      });
    }
    return files;
  }

  private updateSummary(): void {
    if (!this.summaryEl) {
      return;
    }
    const count = this.matchingFiles().length;
    this.summaryEl.setText(`${String(count)} Markdown ${count === 1 ? 'note' : 'notes'} will be updated.`);
  }

  private confirm(): void {
    const files = this.matchingFiles();
    const template = this.plugin.library.get(this.templateId);
    if (!template || files.length === 0) {
      new Notice('No matching notes or page style were found.');
      return;
    }
    new ConfirmationModal(
      this.plugin,
      `Apply “${template.name}” to ${String(files.length)} notes?`,
      'This changes only each note’s templar frontmatter property. The operation can be reversed per note with “Remove Page Style”.',
      async () => {
        let completed = 0;
        for (const file of files) {
          const existing = this.plugin.frontmatter.getStyle(file)?.page;
          const page = clone(existing ?? DEFAULT_PAGE_OPTIONS);
          if (this.pageMode !== 'preserve') {
            page.mode = this.pageMode;
          }
          if (this.pageMode === 'paged') {
            page.size = this.pageSize;
            page.width = this.pageSize === 'letter' ? 816 : 794;
            page.height = this.pageSize === 'letter' ? 1056 : 1123;
          }
          await this.plugin.frontmatter.applyTemplate(file, template, page);
          completed += 1;
        }
        this.plugin.renderer.scheduleRefreshAll();
        this.plugin.refreshSidebars();
        new Notice(`Applied “${template.name}” to ${String(completed)} notes.`);
        this.close();
      },
    ).open();
  }
}

export class ConfirmationModal extends Modal {
  public constructor(
    plugin: TemplarPlugin,
    private readonly title: string,
    private readonly message: string,
    private readonly confirm: () => Promise<void>,
    private readonly confirmLabel = 'Apply changes',
  ) {
    super(plugin.app);
  }

  public onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl('p', { text: this.message });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const confirm = actions.createEl('button', {
      cls: 'mod-warning',
      text: this.confirmLabel,
    });
    confirm.addEventListener('click', () => void runButtonAction(confirm, async () => {
      await this.confirm();
      this.close();
    }));
  }
}

function renderPageOptionSettings(
  container: HTMLElement,
  page: NotePageOptions,
  onUpdate: () => void,
): void {
  let sizeDropdown: DropdownComponent | null = null;
  let widthInput: TextComponent | null = null;
  let heightInput: TextComponent | null = null;
  new Setting(container).setName('Page flow').setHeading();
  new Setting(container)
    .setName('Mode')
    .setDesc('Paged uses a fixed canvas; pageless reflows to the available width.')
    .addDropdown((dropdown) =>
      dropdown
        .addOptions({ pageless: 'Pageless', paged: 'Paged' })
        .setValue(page.mode)
        .onChange((value) => {
          page.mode = value as NotePageOptions['mode'];
          onUpdate();
        }),
    );
  new Setting(container)
    .setName('Page size')
    .setDesc('Used in paged mode and retained when switching modes.')
    .addDropdown((dropdown) => {
      sizeDropdown = dropdown;
      dropdown
        .addOptions({ a4: 'A4', letter: 'US Letter', custom: 'Custom' })
        .setValue(page.size)
        .onChange((value) => {
          page.size = value as NotePageOptions['size'];
          if (value === 'a4') {
            page.width = 794;
            page.height = 1123;
          } else if (value === 'letter') {
            page.width = 816;
            page.height = 1056;
          }
          widthInput?.setValue(String(page.width));
          heightInput?.setValue(String(page.height));
          onUpdate();
        });
    });
  new Setting(container)
    .setName('Page width')
    .setDesc('Width in CSS pixels for the selected preset.')
    .addText((text) => {
      widthInput = text;
      text.setValue(String(page.width)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 480 && next <= 1800) {
          page.width = next;
          page.size = 'custom';
          sizeDropdown?.setValue('custom');
          onUpdate();
        }
      });
    });
  new Setting(container)
    .setName('Page height')
    .setDesc('Height in CSS pixels for the selected preset.')
    .addText((text) => {
      heightInput = text;
      text.setValue(String(page.height)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 640 && next <= 2400) {
          page.height = next;
          page.size = 'custom';
          sizeDropdown?.setValue('custom');
          onUpdate();
        }
      });
    });
  new Setting(container)
    .setName('Page gap')
    .setDesc('Space between sheets in paged mode (8–120 CSS pixels).')
    .addText((text) =>
      text.setValue(String(page.gap)).onChange((value) => {
        const next = Number(value);
        if (Number.isFinite(next) && next >= 8 && next <= 120) {
          page.gap = next;
          onUpdate();
        }
      }),
    );
  new Setting(container)
    .setName('Fit narrow screens')
    .setDesc('Scale the fixed page as a whole on phones and narrow panes without reflowing its text.')
    .addToggle((toggle) =>
      toggle.setValue(page.scaleToFit).onChange((value) => {
        page.scaleToFit = value;
        onUpdate();
      }),
    );
}

async function createFolderTree(plugin: TemplarPlugin, folder: string): Promise<void> {
  const segments = normalizePath(folder).split('/').filter(Boolean);
  let current = '';
  for (const segment of segments) {
    current = current ? `${current}/${segment}` : segment;
    const existing = plugin.app.vault.getAbstractFileByPath(current);
    if (existing && !(existing instanceof TFolder)) {
      throw new Error(`“${current}” is a file, not a folder.`);
    }
    if (!existing) {
      await plugin.app.vault.createFolder(current);
    }
  }
}

function applyFramePreset(template: TemplarTemplate, frame: ImageFrame): void {
  const images = template.images;
  switch (frame) {
    case 'none':
      Object.assign(images, {
        borderWidth: 0,
        bottomBorderWidth: 0,
        cornerRadius: 0,
        shadow: 'none',
      });
      break;
    case 'thin':
      Object.assign(images, { borderWidth: 1, bottomBorderWidth: 1, cornerRadius: 0 });
      break;
    case 'photo':
      Object.assign(images, { borderWidth: 6, bottomBorderWidth: 6, cornerRadius: 0 });
      break;
    case 'polaroid':
      Object.assign(images, { borderWidth: 10, bottomBorderWidth: 34, cornerRadius: 0 });
      break;
    case 'scrapbook':
      Object.assign(images, { borderWidth: 8, bottomBorderWidth: 8, cornerRadius: 1 });
      break;
    case 'rounded':
      Object.assign(images, { borderWidth: 0, bottomBorderWidth: 0, cornerRadius: 12 });
      break;
    case 'technical':
      Object.assign(images, { borderWidth: 2, bottomBorderWidth: 2, cornerRadius: 2 });
      break;
    case 'dark':
      Object.assign(images, {
        borderWidth: 8,
        bottomBorderWidth: 8,
        borderColor: '#2b2724',
        cornerRadius: 1,
      });
      break;
    case 'vintage':
      Object.assign(images, {
        borderWidth: 8,
        bottomBorderWidth: 8,
        borderColor: '#f0e2c5',
        cornerRadius: 2,
      });
      break;
  }
}

async function runButtonAction(
  button: HTMLButtonElement,
  action: () => Promise<void>,
): Promise<void> {
  if (button.disabled) {
    return;
  }
  button.disabled = true;
  try {
    await action();
  } catch (error) {
    new Notice(error instanceof Error ? error.message : String(error));
  } finally {
    if (button.isConnected) {
      button.disabled = false;
    }
  }
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  const match = /^```(?:yaml|yml)?\s*\n([\s\S]*?)\n```$/i.exec(trimmed);
  return match?.[1] ?? trimmed;
}

function validateCompleteTemplate(template: TemplarTemplate): ValidationIssue[] {
  return [...validateTemplate(template).issues, ...validateCustomCss(template.css).issues];
}
