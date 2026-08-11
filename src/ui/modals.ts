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
import { MAX_IMPORT_BYTES } from '../constants';
import type TemplarPlugin from '../main';
import { validateCustomCss } from '../services/css-validator';
import { parseTemplatePack, uniqueCopyId, type PackReview } from '../services/template-pack';
import {
  mergeTemplateUpdate,
  replaceWithLatestTemplate,
  synchronizationStatus,
  type SynchronizationStatus,
} from '../services/synchronization';
import { pageFlowOptions, ruleMatches } from '../services/style-rules';
import { BUILT_IN_TEMPLATES } from '../templates/builtins';
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
  normalizeTemplateFolder,
  validateTemplate,
  validateTemplateSource,
} from '../templates/schema';
import type {
  BaselineMode,
  DividerStyle,
  HeadingTextTransform,
  ImageFloat,
  ImageFrame,
  ImageObjectFit,
  ListMarkerStyle,
  NotePageOptions,
  TemplarNoteStyle,
  TemplarTemplate,
  StyleRule,
  StyleRuleCondition,
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
    const tags = item.metadata.tags.length > 0 ? ` · ${item.metadata.tags.join(', ')}` : '';
    return `${item.metadata.folder} · ${item.name} — ${item.metadata.description}${tags}`;
  }

  public onChooseItem(item: TemplarTemplate): void {
    if (this.intent === 'create') {
      new CreateStyledNoteModal(this.plugin, item).open();
    } else if (this.file) {
      void this.plugin.applyTemplate(item, this.file);
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
  private packReview: PackReview | null = null;
  private readonly packSelection = new Set<number>();
  private readonly conflictChoices = new Map<number, 'keep' | 'replace' | 'copy'>();
  private applyConflictChoiceToRemaining = false;
  private singleConflictChoice: 'keep' | 'replace' | 'copy' = 'copy';

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
    this.packReview = null;
    this.packSelection.clear();
    this.conflictChoices.clear();
    this.singleConflictChoice = 'copy';
    this.saveButton.disabled = true;
    this.previewEl.empty();
    try {
      const input = stripCodeFence(this.inputEl.value);
      if (new Blob([input]).size > MAX_IMPORT_BYTES) {
        throw new Error('The import exceeds Templar’s 8 MB safety limit.');
      }
      const parsed = parseYaml(input) as unknown;
      const packReview = parseTemplatePack(parsed);
      if (packReview) {
        this.packReview = packReview;
        const allIssues = packReview.templates.flatMap((entry) => entry.issues);
        renderIssues(this.validationEl, allIssues.length > 0 ? allIssues : [{ severity: 'suggestion', path: 'pack', message: 'Every selected template is ready to import.' }]);
        this.renderPackReview();
        return;
      }
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
      const existing = this.plugin.library.get(template.id);
      if (existing) {
        this.singleConflictChoice = 'keep';
        new Setting(this.validationEl)
          .setName(`ID conflict: ${template.id}`)
          .setDesc(existing.builtIn ? 'A shipped built-in can never be replaced.' : 'Choose explicitly how to resolve this library conflict.')
          .addDropdown((dropdown) => {
            dropdown.addOption('keep', existing.builtIn ? 'Keep built-in' : 'Keep existing');
            if (!existing.builtIn) dropdown.addOption('replace', 'Replace existing');
            dropdown.addOption('copy', 'Import as custom copy');
            dropdown.setValue(this.singleConflictChoice).onChange((value) => {
              this.singleConflictChoice = value as typeof this.singleConflictChoice;
            });
          });
      }
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
    if (this.packReview) {
      let imported = 0;
      const usedIds = new Set(this.plugin.library.all().map((template) => template.id));
      for (const index of this.packSelection) {
        const review = this.packReview.templates[index];
        if (!review?.valid) continue;
        const incoming = clone(review.template);
        const existing = this.plugin.library.get(incoming.id);
        if (existing) {
          const choice = this.conflictChoices.get(index) ?? 'keep';
          if (choice === 'keep') continue;
          if (choice === 'replace' && !existing.builtIn) {
            await this.plugin.library.save(incoming);
            imported += 1;
            continue;
          }
          incoming.id = uniqueCopyId(incoming.id, usedIds);
        }
        usedIds.add(incoming.id);
        await this.plugin.library.saveAsNew(incoming);
        imported += 1;
      }
      this.plugin.refreshSidebars();
      new Notice(`Imported ${String(imported)} ${imported === 1 ? 'style' : 'styles'} from “${this.packReview.pack.name}”.`);
      this.close();
      return;
    }
    if (!this.importedTemplate) {
      return;
    }
    try {
      const existing = this.plugin.library.get(this.importedTemplate.id);
      if (existing && this.singleConflictChoice === 'keep') {
        new Notice(`Kept existing “${existing.name}”; nothing was imported.`);
        this.close();
        return;
      }
      const saved = existing && this.singleConflictChoice === 'replace' && !existing.builtIn
        ? await this.plugin.library.save(this.importedTemplate)
        : await this.plugin.library.saveAsNew(this.importedTemplate);
      this.plugin.refreshSidebars();
      new Notice(`Imported “${saved.name}”.`);
      this.close();
    } catch (error) {
      new Notice(error instanceof Error ? error.message : String(error));
    }
  }

  private renderPackReview(): void {
    const review = this.packReview;
    if (!review) return;
    this.previewEl.empty();
    const header = this.previewEl.createDiv({ cls: 'templar-pack-header' });
    header.createEl('h3', { text: review.pack.name });
    header.createEl('p', { text: `${String(review.templates.length)} templates${review.pack.author ? ` · By ${review.pack.author}` : ''}` });
    if (review.pack.description) header.createEl('p', { text: review.pack.description });
    if (review.templates.filter((entry) => this.plugin.library.get(entry.template.id)).length > 1) {
      const applyAll = header.createEl('label');
      const checkbox = applyAll.createEl('input', { attr: { type: 'checkbox' } });
      checkbox.checked = this.applyConflictChoiceToRemaining;
      checkbox.addEventListener('change', () => { this.applyConflictChoiceToRemaining = checkbox.checked; });
      applyAll.createSpan({ text: 'Use conflict choices for remaining compatible conflicts' });
    }
    const list = this.previewEl.createDiv({ cls: 'templar-pack-list' });
    const detailPreview = this.previewEl.createDiv({ cls: 'templar-preview-container templar-pack-detail-preview' });
    review.templates.forEach((entry, index) => {
      const row = list.createDiv({ cls: `templar-pack-entry${entry.valid ? '' : ' has-errors'}` });
      const label = row.createEl('label');
      const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
      checkbox.disabled = !entry.valid;
      checkbox.checked = entry.valid;
      if (entry.valid) this.packSelection.add(index);
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) this.packSelection.add(index); else this.packSelection.delete(index);
        this.updatePackSaveButton();
      });
      label.createSpan({ text: entry.template.name });
      const errors = entry.issues.filter((issue) => issue.severity === 'error').length;
      const warnings = entry.issues.filter((issue) => issue.severity === 'warning').length;
      row.createDiv({ cls: 'templar-pack-entry-status', text: errors ? `${String(errors)} errors` : warnings ? `${String(warnings)} warnings` : 'Ready' });
      const preview = row.createEl('button', { text: 'Preview', attr: { 'aria-label': `Preview ${entry.template.name}` } });
      preview.disabled = !entry.valid;
      preview.addEventListener('click', () => void renderTemplatePreview(detailPreview, entry.template, this.plugin.fontMetrics));
      const existing = this.plugin.library.get(entry.template.id);
      if (existing && entry.valid) {
        const conflict = row.createEl('select', { attr: { 'aria-label': `Resolve ID conflict for ${entry.template.name}` } });
        conflict.createEl('option', { value: 'keep', text: existing.builtIn ? 'Keep built-in' : 'Keep existing' });
        if (!existing.builtIn) conflict.createEl('option', { value: 'replace', text: 'Replace existing' });
        conflict.createEl('option', { value: 'copy', text: 'Import as custom copy' });
        conflict.addEventListener('change', () => {
          const choice = conflict.value as 'keep' | 'replace' | 'copy';
          this.conflictChoices.set(index, choice);
          if (this.applyConflictChoiceToRemaining) {
            for (let remaining = index + 1; remaining < review.templates.length; remaining += 1) {
              const remainingExisting = this.plugin.library.get(review.templates[remaining]!.template.id);
              if (!remainingExisting) continue;
              this.conflictChoices.set(remaining, choice === 'replace' && remainingExisting.builtIn ? 'copy' : choice);
            }
          }
        });
        this.conflictChoices.set(index, 'keep');
      }
    });
    this.updatePackSaveButton();
  }

  private updatePackSaveButton(): void {
    this.saveButton.disabled = this.packSelection.size === 0;
    this.saveButton.setText(`Import ${String(this.packSelection.size)} ${this.packSelection.size === 1 ? 'style' : 'styles'}`);
  }
}

export class TemplatePackExportModal extends Modal {
  private readonly selected = new Set<string>();
  private name = 'Templar Style Pack';
  private author = '';
  private description = '';
  private tags = '';

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly templates: TemplarTemplate[] = plugin.library.all(),
  ) {
    super(plugin.app);
    for (const template of templates) this.selected.add(template.id);
    const folders = new Set(templates.map((template) => template.metadata.folder));
    if (folders.size === 1) this.name = `${[...folders][0]} Pack`;
  }

  public onOpen(): void {
    this.setTitle('Export template pack');
    this.modalEl.addClass('templar-modal', 'templar-pack-modal');
    new Setting(this.contentEl).setName('Pack name').addText((text) => text.setValue(this.name).onChange((value) => { this.name = value; }));
    new Setting(this.contentEl).setName('Author').addText((text) => text.setValue(this.author).onChange((value) => { this.author = value; }));
    new Setting(this.contentEl).setName('Description').addTextArea((text) => text.setValue(this.description).onChange((value) => { this.description = value; }));
    new Setting(this.contentEl).setName('Tags').setDesc('Optional, comma-separated pack tags.').addText((text) => text.setValue(this.tags).onChange((value) => { this.tags = value; }));
    this.contentEl.createEl('p', { text: `${String(this.templates.length)} styles available for this pack.` });
    const list = this.contentEl.createDiv({ cls: 'templar-pack-list' });
    for (const template of this.templates) {
      const label = list.createEl('label', { cls: 'templar-pack-entry' });
      const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
      checkbox.checked = true;
      checkbox.addEventListener('change', () => checkbox.checked ? this.selected.add(template.id) : this.selected.delete(template.id));
      label.createSpan({ text: `${template.name} · ${template.metadata.folder}` });
    }
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const exportButton = actions.createEl('button', { cls: 'mod-cta', text: 'Export pack' });
    exportButton.addEventListener('click', () => void runButtonAction(exportButton, async () => {
      const templates = this.templates.filter((template) => this.selected.has(template.id));
      if (templates.length === 0) throw new Error('Select at least one style.');
      const tags = this.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      await this.plugin.exportTemplatePack({ name: this.name, author: this.author, description: this.description, tags }, templates);
      this.close();
    }));
  }
}

interface SyncReviewItem {
  file: TFile;
  style: TemplarNoteStyle;
  source: TemplarTemplate | null;
  status: SynchronizationStatus;
  action: 'safe' | 'merge' | 'replace' | 'skip';
}

export class SynchronizationReviewModal extends Modal {
  private items: SyncReviewItem[] = [];
  private overview = { total: 0, upToDate: 0, localOnly: 0, safe: 0, modified: 0, legacy: 0, missing: 0 };

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly templateId?: string,
  ) { super(plugin.app); }

  public onOpen(): void {
    this.setTitle('Review template updates');
    this.modalEl.addClass('templar-modal', 'templar-sync-modal');
    this.plugin.ensureUsageIndex();
    const candidates = this.plugin.usageIndex.allEntries().flatMap((entry) => {
      if (!entry.style || (this.templateId && entry.style.sourceTemplateId !== this.templateId)) return [];
      const file = this.app.vault.getAbstractFileByPath(entry.path);
      if (!(file instanceof TFile)) return [];
      const source = this.plugin.library.get(entry.style.sourceTemplateId ?? entry.style.id);
      const status = synchronizationStatus(entry.style, source);
      const action: SyncReviewItem['action'] = status.state === 'update-available'
        ? 'safe'
        : status.state === 'modified-update-available'
          ? 'merge'
          : 'skip';
      return [{ file, style: entry.style, source, status, action }];
    });
    this.overview = {
      total: candidates.length,
      upToDate: candidates.filter((item) => item.status.state === 'up-to-date').length,
      localOnly: candidates.filter((item) => item.status.state === 'modified').length,
      safe: candidates.filter((item) => item.status.state === 'update-available').length,
      modified: candidates.filter((item) => item.status.state === 'modified-update-available').length,
      legacy: candidates.filter((item) => item.status.state === 'legacy-update-unknown').length,
      missing: candidates.filter((item) => item.status.state === 'source-missing').length,
    };
    this.items = candidates.filter((item) => item.status.updateAvailable || item.status.state === 'source-missing');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    if (this.templateId) {
      this.contentEl.createEl('h3', { text: `Template: ${this.plugin.library.get(this.templateId)?.name ?? this.templateId}` });
    }
    this.contentEl.createEl('p', { text: `${String(this.overview.total)} styled notes · ${String(this.overview.upToDate)} up to date · ${String(this.overview.localOnly)} locally modified · ${String(this.overview.safe)} safe updates · ${String(this.overview.modified)} modified + update · ${String(this.overview.legacy)} legacy · ${String(this.overview.missing)} source missing` });
    if (this.items.length === 0) {
      this.contentEl.createDiv({ cls: 'templar-library-empty', text: 'Every indexed note is up to date.' });
      return;
    }
    const selectSafe = this.contentEl.createEl('button', { text: 'Select all safe updates' });
    selectSafe.addEventListener('click', () => { for (const item of this.items) if (item.status.state === 'update-available') item.action = 'safe'; this.render(); });
    const list = this.contentEl.createDiv({ cls: 'templar-sync-list' });
    for (const item of this.items) {
      const row = list.createDiv({ cls: 'templar-sync-entry' });
      row.createDiv({ cls: 'templar-sync-note', text: item.file.path });
      row.createDiv({ cls: 'templar-sync-state', text: item.status.state.replace(/-/g, ' ') });
      const open = row.createEl('button', { text: 'Open note' });
      open.addEventListener('click', () => void this.app.workspace.getLeaf(false).openFile(item.file));
      const choice = row.createEl('select', { attr: { 'aria-label': `Update choice for ${item.file.basename}` } });
      if (item.status.state === 'update-available') choice.createEl('option', { value: 'safe', text: 'Update safely' });
      if (item.status.state === 'modified-update-available') choice.createEl('option', { value: 'merge', text: 'Keep my changes where possible' });
      if (item.source) choice.createEl('option', { value: 'replace', text: 'Replace with latest' });
      choice.createEl('option', { value: 'skip', text: item.status.legacy ? 'Keep current / skip' : 'Skip this note' });
      choice.value = item.action;
      choice.addEventListener('change', () => { item.action = choice.value as SyncReviewItem['action']; });
      if (item.status.legacy) row.createEl('p', { text: 'Templar cannot reliably separate local changes from the original template for this older note.' });
    }
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const close = actions.createEl('button', { text: 'Cancel' });
    close.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Review and update…' });
    apply.addEventListener('click', () => this.confirm());
  }

  private confirm(): void {
    const counts = {
      safe: this.items.filter((item) => item.action === 'safe').length,
      merge: this.items.filter((item) => item.action === 'merge').length,
      replace: this.items.filter((item) => item.action === 'replace').length,
      skip: this.items.filter((item) => item.action === 'skip').length,
    };
    new ConfirmationModal(this.plugin, 'Apply reviewed template updates?', `${String(counts.safe)} will update safely, ${String(counts.merge)} will merge local changes, ${String(counts.replace)} will be replaced, and ${String(counts.skip)} will be skipped.`, async () => this.execute(), 'Apply updates').open();
  }

  private async execute(): Promise<void> {
    let completed = 0;
    for (const item of this.items) {
      if (item.action === 'skip' || !item.source) continue;
      const style = item.action === 'merge'
        ? mergeTemplateUpdate(item.style, item.source)
        : replaceWithLatestTemplate(item.style, item.source);
      await this.plugin.frontmatter.writeStyle(item.file, style);
      completed += 1;
      if (completed % 20 === 0) await new Promise<void>((resolve) => this.contentEl.ownerDocument.defaultView?.setTimeout(resolve, 0));
    }
    this.plugin.renderer.scheduleRefreshAll();
    this.plugin.refreshSidebars();
    new Notice(`Updated ${String(completed)} ${completed === 1 ? 'note' : 'notes'}.`);
    this.close();
  }
}

export class StyleRulesModal extends Modal {
  public constructor(private readonly plugin: TemplarPlugin) { super(plugin.app); }

  public onOpen(): void {
    this.setTitle('Style rules');
    this.modalEl.addClass('templar-modal', 'templar-rules-modal');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Rules apply only to unstyled notes. When multiple rules match, the first matching rule is used.' });
    const add = this.contentEl.createEl('button', { cls: 'mod-cta', text: 'Add rule' });
    add.addEventListener('click', () => new StyleRuleEditorModal(this.plugin, null, () => this.render()).open());
    const list = this.contentEl.createDiv({ cls: 'templar-rules-list' });
    this.plugin.settings.styleRules.forEach((rule, index) => {
      const row = list.createDiv({ cls: 'templar-rule-entry' });
      row.draggable = true;
      row.dataset.ruleIndex = String(index);
      row.addEventListener('dragstart', (event) => event.dataTransfer?.setData('text/plain', String(index)));
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData('text/plain'));
        if (Number.isInteger(from)) void this.moveTo(from, index);
      });
      row.createSpan({ cls: 'templar-drag-handle', text: '⋮⋮', attr: { title: 'Drag to reorder', 'aria-hidden': 'true' } });
      const enabled = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Enable ${rule.name}` } });
      enabled.checked = rule.enabled;
      enabled.addEventListener('change', () => { rule.enabled = enabled.checked; void this.plugin.saveSettings(); });
      const summary = row.createDiv({ cls: 'templar-rule-summary' });
      summary.createDiv({ cls: 'templar-rule-name', text: rule.name });
      summary.createDiv({ text: `${rule.conditions.length} ${rule.conditions.length === 1 ? 'condition' : 'conditions'} · ${this.plugin.library.get(rule.templateId)?.name ?? 'Missing style'}` });
      const up = row.createEl('button', { text: 'Move up', attr: { 'aria-label': `Move ${rule.name} up` } });
      up.disabled = index === 0;
      up.addEventListener('click', () => void this.move(index, -1));
      const down = row.createEl('button', { text: 'Move down', attr: { 'aria-label': `Move ${rule.name} down` } });
      down.disabled = index === this.plugin.settings.styleRules.length - 1;
      down.addEventListener('click', () => void this.move(index, 1));
      const preview = row.createEl('button', { text: 'Preview existing matches' });
      preview.addEventListener('click', () => this.previewMatches(rule));
      const edit = row.createEl('button', { text: 'Edit' });
      edit.addEventListener('click', () => new StyleRuleEditorModal(this.plugin, index, () => this.render()).open());
      const remove = row.createEl('button', { text: 'Delete' });
      remove.addEventListener('click', () => void this.remove(index));
    });
  }

  private async move(index: number, delta: -1 | 1): Promise<void> {
    const rules = this.plugin.settings.styleRules;
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    [rules[index], rules[target]] = [rules[target]!, rules[index]!];
    await this.plugin.saveSettings();
    this.render();
  }

  private async moveTo(from: number, to: number): Promise<void> {
    const rules = this.plugin.settings.styleRules;
    if (from < 0 || from >= rules.length || to < 0 || to >= rules.length || from === to) return;
    const [rule] = rules.splice(from, 1);
    if (!rule) return;
    rules.splice(to, 0, rule);
    await this.plugin.saveSettings();
    this.render();
  }

  private async remove(index: number): Promise<void> {
    this.plugin.settings.styleRules.splice(index, 1);
    await this.plugin.saveSettings();
    this.render();
  }

  private previewMatches(rule: StyleRule): void {
    const matches: TFile[] = [];
    let unavailable = 0;
    const needsMetadata = rule.conditions.some((condition) => condition.type === 'tag' || condition.type === 'frontmatter');
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const facts = {
        path: file.path,
        basename: file.basename,
        folder: file.parent?.path ?? '',
        tags: cache ? getAllTags(cache) ?? [] : [],
        frontmatter: cache?.frontmatter ?? {},
        metadataReady: cache !== null,
      };
      if (!cache && needsMetadata) {
        const staticConditions = rule.conditions.filter((condition) => condition.type === 'folder' || condition.type === 'filename');
        if (staticConditions.length === 0 || ruleMatches({ ...rule, conditions: staticConditions }, facts)) unavailable += 1;
      } else if (ruleMatches(rule, facts)) {
        matches.push(file);
      }
    }
    const eligible = matches.filter((file) => !this.plugin.frontmatter.hasStyle(file));
    const styled = matches.length - eligible.length;
    const missingTemplate = this.plugin.library.get(rule.templateId) === null;
    const invalid = missingTemplate ? eligible.length : 0;
    const eligibleCount = missingTemplate ? 0 : eligible.length;
    new ConfirmationModal(this.plugin, `${String(matches.length)} notes match “${rule.name}”`, `${String(eligibleCount)} unstyled and eligible; ${String(styled)} already styled and will be skipped; ${String(unavailable + invalid)} unavailable or invalid.`, async () => {
      const template = this.plugin.library.get(rule.templateId);
      if (!template) throw new Error('The rule’s style no longer exists.');
      const page = { ...clone(DEFAULT_PAGE_OPTIONS), ...pageFlowOptions(rule.pageFlow === 'default' ? this.plugin.settings.defaultNewPageFlow : rule.pageFlow) };
      let completed = 0;
      for (const file of eligible) {
        await this.plugin.applyTemplate(template, file, page, { recordRecent: false, notify: false, appliedByRule: { id: rule.id, name: rule.name } });
        completed += 1;
        if (completed % 20 === 0) await new Promise<void>((resolve) => this.contentEl.ownerDocument.defaultView?.setTimeout(resolve, 0));
      }
      new Notice(`Applied “${template.name}” to ${String(completed)} eligible notes.`);
    }, `Apply to ${String(eligibleCount)} eligible notes`).open();
  }
}

class StyleRuleEditorModal extends Modal {
  private readonly rule: StyleRule;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly index: number | null,
    private readonly changed: () => void,
  ) {
    super(plugin.app);
    this.rule = index === null
      ? { id: `rule-${Date.now().toString(36)}`, name: 'New rule', enabled: true, conditions: [{ type: 'folder', folder: '', includeSubfolders: true }], templateId: plugin.settings.defaultTemplateId, pageFlow: 'default' }
      : clone(plugin.settings.styleRules[index]!);
  }

  public onOpen(): void { this.setTitle(this.index === null ? 'Add Style Rule' : 'Edit Style Rule'); this.render(); }

  private render(): void {
    this.contentEl.empty();
    new Setting(this.contentEl).setName('Name').addText((text) => text.setValue(this.rule.name).onChange((value) => { this.rule.name = value; }));
    const options: Record<string, string> = {};
    for (const template of this.plugin.library.all()) options[template.id] = template.name;
    new Setting(this.contentEl).setName('Style to apply').addDropdown((dropdown) => dropdown.addOptions(options).setValue(this.rule.templateId).onChange((value) => { this.rule.templateId = value; }));
    new Setting(this.contentEl).setName('Default page behavior').addDropdown((dropdown) => dropdown.addOptions({ default: 'Use default page flow', pageless: 'Pageless', 'paged-a4': 'Paged A4', 'paged-letter': 'Paged Letter' }).setValue(this.rule.pageFlow).onChange((value) => { this.rule.pageFlow = value as StyleRule['pageFlow']; }));
    this.contentEl.createEl('h3', { text: 'Conditions (all must match)' });
    const conditions = this.contentEl.createDiv({ cls: 'templar-rule-conditions' });
    this.rule.conditions.forEach((condition, index) => this.renderCondition(conditions, condition, index));
    const add = this.contentEl.createEl('button', { text: 'Add condition' });
    add.addEventListener('click', () => { this.rule.conditions.push({ type: 'tag', tag: '' }); this.render(); });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' }); cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save rule' }); save.addEventListener('click', () => void runButtonAction(save, async () => this.save()));
  }

  private renderCondition(container: HTMLElement, condition: StyleRuleCondition, index: number): void {
    const row = container.createDiv({ cls: 'templar-rule-condition' });
    const type = row.createEl('select', { attr: { 'aria-label': `Condition ${String(index + 1)} type` } });
    for (const [value, label] of [['folder', 'Folder'], ['tag', 'Tag'], ['filename', 'Filename'], ['frontmatter', 'Frontmatter property']] as const) type.createEl('option', { value, text: label });
    type.value = condition.type;
    type.addEventListener('change', () => {
      this.rule.conditions[index] = type.value === 'folder' ? { type: 'folder', folder: '', includeSubfolders: true }
        : type.value === 'tag' ? { type: 'tag', tag: '' }
          : type.value === 'filename' ? { type: 'filename', operator: 'contains', value: '' }
            : { type: 'frontmatter', property: '', value: '' };
      this.render();
    });
    if (condition.type === 'folder') {
      const input = row.createEl('input', { attr: { type: 'text', placeholder: 'Projects/research', 'aria-label': 'Folder path' } }); input.value = condition.folder; input.addEventListener('input', () => { condition.folder = input.value; });
      const label = row.createEl('label'); const check = label.createEl('input', { attr: { type: 'checkbox' } }); check.checked = condition.includeSubfolders; check.addEventListener('change', () => { condition.includeSubfolders = check.checked; }); label.createSpan({ text: 'Include subfolders' });
    } else if (condition.type === 'tag') {
      const input = row.createEl('input', { attr: { type: 'text', placeholder: 'Meeting', 'aria-label': 'Tag' } }); input.value = condition.tag; input.addEventListener('input', () => { condition.tag = input.value.replace(/^#/, ''); });
    } else if (condition.type === 'filename') {
      const operator = row.createEl('select', { attr: { 'aria-label': 'Filename match type' } });
      for (const [value, label] of [['starts-with', 'Starts with'], ['ends-with', 'Ends with'], ['contains', 'Contains'], ['exact', 'Exact match']] as const) operator.createEl('option', { value, text: label });
      operator.value = condition.operator; operator.addEventListener('change', () => { condition.operator = operator.value as typeof condition.operator; });
      const input = row.createEl('input', { attr: { type: 'text', 'aria-label': 'Filename value' } }); input.value = condition.value; input.addEventListener('input', () => { condition.value = input.value; });
    } else {
      const property = row.createEl('input', { attr: { type: 'text', placeholder: 'Status', 'aria-label': 'Frontmatter property' } }); property.value = condition.property; property.addEventListener('input', () => { condition.property = property.value; });
      const value = row.createEl('input', { attr: { type: 'text', placeholder: 'Published', 'aria-label': 'Frontmatter value' } }); value.value = condition.value; value.addEventListener('input', () => { condition.value = value.value; });
    }
    const remove = row.createEl('button', { text: 'Remove', attr: { 'aria-label': `Remove condition ${String(index + 1)}` } });
    remove.addEventListener('click', () => { this.rule.conditions.splice(index, 1); this.render(); });
  }

  private async save(): Promise<void> {
    if (!this.rule.name.trim() || this.rule.conditions.length === 0) throw new Error('Give the rule a name and at least one condition.');
    const empty = this.rule.conditions.some((condition) => condition.type === 'folder' ? !condition.folder.trim() : condition.type === 'tag' ? !condition.tag.trim() : condition.type === 'filename' ? !condition.value.trim() : !condition.property.trim());
    if (empty) throw new Error('Complete every condition before saving.');
    if (this.index === null) this.plugin.settings.styleRules.push(this.rule); else this.plugin.settings.styleRules[this.index] = this.rule;
    await this.plugin.saveSettings();
    this.changed();
    this.close();
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
      const input = stripCodeFence(this.inputEl.value);
      if (new Blob([input]).size > MAX_IMPORT_BYTES) {
        throw new Error('The page-style YAML exceeds Templar’s 8 MB safety limit.');
      }
      const parsed = parseYaml(input) as unknown;
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

export class CurrentNoteInspectorModal extends Modal {
  private readonly original: TemplarNoteStyle;
  private readonly draft: TemplarNoteStyle;
  private readonly owner = `inspector-${Math.random().toString(36).slice(2)}`;
  private saved = false;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    style: TemplarNoteStyle,
  ) {
    super(plugin.app);
    this.original = clone(style);
    this.draft = clone(style);
  }

  public onOpen(): void {
    this.setTitle(`Customize ${this.file.basename}`);
    this.modalEl.addClass('templar-modal', 'templar-inspector-modal');
    this.contentEl.createEl('p', { text: 'Changes here affect only this note. Nothing is written until save changes.' });
    this.renderAppearance();
    this.renderTypography();
    this.renderHeadings();
    this.renderLayout();
    this.renderImages();
    this.renderPage();
    this.renderWatermark();
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const discard = actions.createEl('button', { text: 'Discard changes' });
    discard.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save changes' });
    save.addEventListener('click', () => void runButtonAction(save, async () => {
      await this.plugin.frontmatter.writeStyle(this.file, this.draft);
      this.saved = true;
      await this.plugin.preview.cancel(this.owner);
      await this.plugin.renderer.refreshFile(this.file);
      this.plugin.refreshSidebars();
      this.plugin.updateStatusBar();
      this.close();
    }));
    this.updatePreview();
  }

  public onClose(): void {
    if (!this.saved) void this.plugin.preview.cancel(this.owner);
    this.contentEl.empty();
  }

  private section(title: string, key: keyof TemplarTemplate | 'page'): HTMLElement {
    const details = this.contentEl.createEl('details', { cls: 'templar-inspector-section' });
    details.open = title === 'Appearance';
    const summary = details.createEl('summary');
    summary.createSpan({ text: title });
    const reset = summary.createEl('button', { text: 'Reset section', attr: { 'aria-label': `Reset ${title}` } });
    reset.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const source = key === 'page' ? null : this.plugin.library.get(this.draft.sourceTemplateId ?? this.draft.id);
      const baseline = source ?? this.original;
      if (title === 'Appearance') {
        this.draft.paper = clone(baseline.paper);
        this.draft.typography.textColor = baseline.typography.textColor;
        this.draft.typography.mutedColor = baseline.typography.mutedColor;
        this.draft.blocks.highlightBackground = baseline.blocks.highlightBackground;
        this.draft.blocks.highlightTextColor = baseline.blocks.highlightTextColor;
        this.contentEl.empty();
        this.onOpen();
        return;
      }
      if (title === 'Typography') {
        this.draft.typography = clone(baseline.typography);
        this.draft.baseline = clone(baseline.baseline);
        this.contentEl.empty();
        this.onOpen();
        return;
      }
      const replacement = source
        ? clone(source[key as keyof TemplarTemplate])
        : clone(this.original[key as keyof TemplarNoteStyle]);
      (this.draft as unknown as Record<string, unknown>)[key] = replacement;
      this.contentEl.empty();
      this.onOpen();
    });
    return details.createDiv({ cls: 'templar-inspector-controls' });
  }

  private renderAppearance(): void {
    const section = this.section('Appearance', 'paper');
    new Setting(section).setName('Paper color').addColorPicker((picker) => picker.setValue(this.draft.paper.color).onChange((value) => { this.draft.paper.color = value; this.updatePreview(); }));
    new Setting(section).setName('Pattern').addDropdown((dropdown) => dropdown.addOptions({ blank: 'Blank', ruled: 'Ruled', ledger: 'Ledger', 'dot-grid': 'Dot grid', graph: 'Graph', 'cross-hatch': 'Cross hatch', diagonal: 'Diagonal', hex: 'Hex', scallop: 'Scallop' }).setValue(this.draft.paper.pattern).onChange((value) => { this.draft.paper.pattern = value as PaperPattern; this.updatePreview(); }));
    new Setting(section).setName('Pattern color').addColorPicker((picker) => picker.setValue(this.draft.paper.patternColor).onChange((value) => { this.draft.paper.patternColor = value; this.updatePreview(); }));
    new Setting(section).setName('Text color').addColorPicker((picker) => picker.setValue(this.draft.typography.textColor).onChange((value) => { this.draft.typography.textColor = value; this.updatePreview(); }));
    new Setting(section).setName('Highlight background').addColorPicker((picker) => picker.setValue(this.draft.blocks.highlightBackground).onChange((value) => { this.draft.blocks.highlightBackground = value; this.updatePreview(); }));
    new Setting(section).setName('Highlight text').addColorPicker((picker) => picker.setValue(this.draft.blocks.highlightTextColor).onChange((value) => { this.draft.blocks.highlightTextColor = value; this.updatePreview(); }));
  }

  private renderTypography(): void {
    const section = this.section('Typography', 'typography');
    new Setting(section).setName('Body font').addText((text) => text.setValue(this.draft.typography.bodyFont).onChange((value) => { this.draft.typography.bodyFont = value; this.updatePreview(); }));
    this.slider(section, 'Body size', this.draft.typography.bodySize, 8, 72, (value) => { this.draft.typography.bodySize = value; });
    this.slider(section, 'Body weight', this.draft.typography.bodyWeight, 100, 900, (value) => { this.draft.typography.bodyWeight = value; }, 100);
    this.slider(section, 'Line height (0 = automatic)', this.draft.typography.bodyLineHeight, 0, 120, (value) => { this.draft.typography.bodyLineHeight = value; });
    this.slider(section, 'Baseline unit', this.draft.baseline.unit, 12, 96, (value) => { this.draft.baseline.unit = value; });
  }

  private renderHeadings(): void {
    const section = this.section('Headings', 'headings');
    const originalSizes = clone(this.draft.headings);
    this.slider(section, 'Overall heading scale', 100, 60, 160, (value) => {
      for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
        this.draft.headings[key].size = Math.round(originalSizes[key].size * value / 100);
      }
    });
    section.createEl('p', { text: 'Use the full template creator or raw editor for per-heading controls.' });
  }

  private renderLayout(): void {
    const section = this.section('Layout', 'layout');
    this.slider(section, 'Content width', this.draft.layout.maxWidth, 320, 2400, (value) => { this.draft.layout.maxWidth = value; }, 10);
    for (const [label, key, max] of [['Top padding', 'paddingTop', 400], ['Right padding', 'paddingRight', 400], ['Bottom padding', 'paddingBottom', 600], ['Left padding', 'paddingLeft', 400]] as const) {
      this.slider(section, label, this.draft.layout[key], 0, max, (value) => { this.draft.layout[key] = value; });
    }
    this.slider(section, 'Page radius', this.draft.layout.pageRadius, 0, 80, (value) => { this.draft.layout.pageRadius = value; });
    new Setting(section).setName('Page shadow').addText((text) => text.setValue(this.draft.layout.pageShadow).onChange((value) => { this.draft.layout.pageShadow = value; this.updatePreview(); }));
  }

  private renderImages(): void {
    const section = this.section('Images', 'images');
    new Setting(section).setName('Default frame').addDropdown((dropdown) => dropdown.addOptions({ none: 'None', thin: 'Thin', photo: 'Photo', polaroid: 'Polaroid', scrapbook: 'Scrapbook', rounded: 'Rounded', technical: 'Technical', dark: 'Dark', vintage: 'Vintage' }).setValue(this.draft.images.frame).onChange((value) => { this.draft.images.frame = value as ImageFrame; applyFramePreset(this.draft, this.draft.images.frame); this.updatePreview(); }));
    this.slider(section, 'Maximum width', this.draft.images.maxWidth, 10, 100, (value) => { this.draft.images.maxWidth = value; });
    this.slider(section, 'Top spacing', this.draft.images.topSpacing, 0, 180, (value) => { this.draft.images.topSpacing = value; });
    this.slider(section, 'Bottom spacing', this.draft.images.bottomSpacing, 0, 180, (value) => { this.draft.images.bottomSpacing = value; });
    this.slider(section, 'Sepia', this.draft.images.sepia, 0, 1, (value) => { this.draft.images.sepia = value; }, 0.05);
  }

  private renderPage(): void {
    const section = this.section('Page', 'page');
    renderPageOptionSettings(section, this.draft.page, () => this.updatePreview());
  }

  private renderWatermark(): void {
    const section = this.section('Watermark', 'watermark');
    new Setting(section).setName('Text').addText((text) => text.setValue(this.draft.watermark.text).onChange((value) => { this.draft.watermark.text = value; this.updatePreview(); }));
    this.slider(section, 'Opacity', this.draft.watermark.opacity, 0.05, 1, (value) => { this.draft.watermark.opacity = value; }, 0.05);
    this.slider(section, 'Size', this.draft.watermark.size, 24, 240, (value) => { this.draft.watermark.size = value; });
    this.slider(section, 'Rotation', this.draft.watermark.rotation, -45, 45, (value) => { this.draft.watermark.rotation = value; });
  }

  private slider(container: HTMLElement, name: string, value: number, min: number, max: number, update: (value: number) => void, step = 1): void {
    new Setting(container).setName(name).addSlider((slider) => slider.setLimits(min, max, step).setValue(value).onChange((next) => { update(next); this.updatePreview(); }));
  }

  private updatePreview(): void {
    const leaf = this.plugin.activeMarkdownLeaf();
    if (!leaf) return;
    this.plugin.preview.previewStyle(this.owner, leaf, this.file, this.draft);
  }
}

export class TemplateCreatorModal extends Modal {
  private draft: TemplarTemplate;
  private readonly originalId: string | null;
  private readonly sourceBuiltInId: string | null;
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
    this.sourceBuiltInId = template && template.builtIn ? template.id : null;
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
    if (this.sourceBuiltInId) {
      const resetButton = actions.createEl('button', {
        cls: 'mod-warning',
        text: 'Reset to default',
      });
      resetButton.addEventListener('click', () => void this.resetToDefault());
    }
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
    this.folderSetting();
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
        .addOptions({
          blank: 'Blank',
          ruled: 'Ruled',
          ledger: 'Ledger',
          'dot-grid': 'Dot grid',
          graph: 'Graph',
          'cross-hatch': 'Cross hatch',
          diagonal: 'Diagonal',
          hex: 'Hex',
          scallop: 'Scallop',
        })
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
    this.sliderSetting('Pattern opacity', this.draft.paper.patternOpacity, 0, 1, 0.05, (value) => {
      this.draft.paper.patternOpacity = value;
    });
    this.sliderSetting('Pattern scale', this.draft.paper.patternScale, 0.25, 4, 0.05, (value) => {
      this.draft.paper.patternScale = value;
    });
    this.sliderSetting('Dot radius', this.draft.paper.dotRadius, 0.5, 6, 0.5, (value) => {
      this.draft.paper.dotRadius = value;
    });
    this.sliderSetting('Graph major interval', this.draft.paper.graphMajorInterval, 2, 10, 1, (value) => {
      this.draft.paper.graphMajorInterval = value;
    });
    this.toggleSetting('Margin line', this.draft.paper.marginLine, (value) => {
      this.draft.paper.marginLine = value;
    });
    this.colorSetting('Margin color', this.draft.paper.marginColor, (value) => {
      this.draft.paper.marginColor = value;
    });
    this.sliderSetting('Margin offset', this.draft.paper.marginOffset, 0, 400, 2, (value) => {
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
    this.sliderSetting('Body line height', this.draft.typography.bodyLineHeight, 0, 120, 1, (value) => {
      this.draft.typography.bodyLineHeight = value;
    }).setDesc('0 = automatic rhythm.');
    this.sliderSetting('First line indent', this.draft.typography.firstLineIndent, 0, 120, 2, (value) => {
      this.draft.typography.firstLineIndent = value;
    }).setDesc('Reading view only.');
    this.toggleSetting('Drop cap', this.draft.typography.dropCap, (value) => {
      this.draft.typography.dropCap = value;
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
    this.headingLevelSettings('h5', 'Heading 5');
    this.headingLevelSettings('h6', 'Heading 6');

    this.heading('Lists');
    new Setting(this.editorEl).setName('Bullet style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ disc: 'Disc', circle: 'Circle', square: 'Square', none: 'None' })
        .setValue(this.draft.lists.markerStyle)
        .onChange((value) => {
          this.draft.lists.markerStyle = value as ListMarkerStyle;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Marker color', this.draft.lists.markerColor, (value) => {
      this.draft.lists.markerColor = value;
    });
    this.toggleSetting('Indent guides', this.draft.lists.indentGuides, (value) => {
      this.draft.lists.indentGuides = value;
    });
    this.colorSetting('Indent guide color', this.draft.lists.indentGuideColor, (value) => {
      this.draft.lists.indentGuideColor = value;
    });
    this.sliderSetting('Nested list indent', this.draft.lists.nestedIndent, 0, 120, 2, (value) => {
      this.draft.lists.nestedIndent = value;
    }).setDesc('0 = Obsidian default. Reading view only.');

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
    this.sliderSetting('Page corner radius', this.draft.layout.pageRadius, 0, 80, 1, (value) => {
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
    this.sliderSetting('Saturation', this.draft.images.saturation, 0, 4, 0.05, (value) => {
      this.draft.images.saturation = value;
    });
    this.sliderSetting('Contrast', this.draft.images.contrast, 0, 4, 0.05, (value) => {
      this.draft.images.contrast = value;
    });
    new Setting(this.editorEl).setName('Float').addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', left: 'Left', right: 'Right' })
        .setValue(this.draft.images.float)
        .onChange((value) => {
          this.draft.images.float = value as ImageFloat;
          void this.updatePreview();
        }),
    );
    new Setting(this.editorEl).setName('Object fit').addDropdown((dropdown) =>
      dropdown
        .addOptions({ contain: 'Contain', cover: 'Cover', fill: 'Fill', 'scale-down': 'Scale down' })
        .setValue(this.draft.images.objectFit)
        .onChange((value) => {
          this.draft.images.objectFit = value as ImageObjectFit;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Duotone', this.draft.images.duotone, (value) => {
      this.draft.images.duotone = value;
    });

    this.heading('Links, quotes, code, tables, lists, and callouts');
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
    this.sliderSetting('Code size', this.draft.blocks.codeSize, 8, 48, 1, (value) => {
      this.draft.blocks.codeSize = value;
    });
    this.colorSetting('Table borders', this.draft.blocks.tableBorder, (value) => {
      this.draft.blocks.tableBorder = value;
    });
    this.colorSetting('Table header background', this.draft.blocks.tableHeaderBackground, (value) => {
      this.draft.blocks.tableHeaderBackground = value;
    });
    this.sliderSetting('Table border width', this.draft.blocks.tableBorderWidth, 0, 12, 1, (value) => {
      this.draft.blocks.tableBorderWidth = value;
    });
    this.sliderSetting('Table font size', this.draft.blocks.tableFontSize, 8, 48, 1, (value) => {
      this.draft.blocks.tableFontSize = value;
    });
    this.colorSetting('Table text', this.draft.blocks.tableTextColor, (value) => {
      this.draft.blocks.tableTextColor = value;
    });
    this.colorSetting('Table header text', this.draft.blocks.tableHeaderTextColor, (value) => {
      this.draft.blocks.tableHeaderTextColor = value;
    });
    this.sliderSetting('Table padding', this.draft.blocks.tablePadding, 0, 40, 1, (value) => {
      this.draft.blocks.tablePadding = value;
    });
    this.toggleSetting('Striped table rows', this.draft.blocks.tableStriped, (value) => {
      this.draft.blocks.tableStriped = value;
    });
    this.colorSetting('Table stripe color', this.draft.blocks.tableStripeColor, (value) => {
      this.draft.blocks.tableStripeColor = value;
    });
    this.colorSetting('Checkbox accent', this.draft.blocks.checkboxAccent, (value) => {
      this.draft.blocks.checkboxAccent = value;
    });
    this.colorSetting('Divider color', this.draft.blocks.dividerColor, (value) => {
      this.draft.blocks.dividerColor = value;
    });
    this.sliderSetting('Divider width', this.draft.blocks.dividerWidth, 1, 20, 1, (value) => {
      this.draft.blocks.dividerWidth = value;
    });
    new Setting(this.editorEl).setName('Divider style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double', fade: 'Fade' })
        .setValue(this.draft.blocks.dividerStyle)
        .onChange((value) => {
          this.draft.blocks.dividerStyle = value as DividerStyle;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Callout accent', this.draft.blocks.calloutAccent, (value) => {
      this.draft.blocks.calloutAccent = value;
    });
    this.colorSetting('Callout background', this.draft.blocks.calloutBackground, (value) => {
      this.draft.blocks.calloutBackground = value;
    });
    this.colorSetting('Callout text', this.draft.blocks.calloutTextColor, (value) => {
      this.draft.blocks.calloutTextColor = value;
    });
    this.colorSetting('Callout title', this.draft.blocks.calloutTitleColor, (value) => {
      this.draft.blocks.calloutTitleColor = value;
    });
    this.colorSetting('Callout icon', this.draft.blocks.calloutIconColor, (value) => {
      this.draft.blocks.calloutIconColor = value;
    });
    this.sliderSetting('Callout border width', this.draft.blocks.calloutBorderWidth, 0, 12, 1, (value) => {
      this.draft.blocks.calloutBorderWidth = value;
    });
    this.sliderSetting('Callout corner radius', this.draft.blocks.calloutRadius, 0, 60, 1, (value) => {
      this.draft.blocks.calloutRadius = value;
    });
    this.colorSetting('Embed background', this.draft.blocks.embedBackground, (value) => {
      this.draft.blocks.embedBackground = value;
    });
    this.colorSetting('Embed accent', this.draft.blocks.embedAccent, (value) => {
      this.draft.blocks.embedAccent = value;
    });
    this.sliderSetting('Embed corner radius', this.draft.blocks.embedRadius, 0, 60, 1, (value) => {
      this.draft.blocks.embedRadius = value;
    });

    this.heading('Watermark');
    this.textSetting('Watermark text', 'Leave empty to hide the watermark.', this.draft.watermark.text, (value) => {
      this.draft.watermark.text = value;
    });
    this.colorSetting('Watermark color', this.draft.watermark.color, (value) => {
      this.draft.watermark.color = value;
    });
    this.sliderSetting('Watermark size', this.draft.watermark.size, 24, 240, 2, (value) => {
      this.draft.watermark.size = value;
    });
    this.sliderSetting('Watermark rotation', this.draft.watermark.rotation, -45, 45, 1, (value) => {
      this.draft.watermark.rotation = value;
    });
    this.sliderSetting('Watermark opacity', this.draft.watermark.opacity, 0.05, 1, 0.05, (value) => {
      this.draft.watermark.opacity = value;
    });
  }

  private headingLevelSettings(
    level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
    label: string,
  ): void {
    const heading = this.draft.headings[level];
    this.textSetting(`${label} font`, 'Use a complete fallback stack.', heading.font, (value) => {
      this.draft.headings[level].font = value;
    });
    this.sliderSetting(`${label} size`, heading.size, 8, 144, 1, (value) => {
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
    this.sliderSetting(`${label} letter spacing`, heading.letterSpacing, 0, 10, 0.5, (value) => {
      this.draft.headings[level].letterSpacing = value;
    });
    new Setting(this.editorEl).setName(`${label} text transform`).addDropdown((dropdown) =>
      dropdown
        .addOptions({
          none: 'None',
          uppercase: 'UPPERCASE',
          lowercase: 'lowercase',
          capitalize: 'Capitalize',
        })
        .setValue(heading.textTransform)
        .onChange((value) => {
          this.draft.headings[level].textTransform = value as HeadingTextTransform;
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
    this.folderSetting();

    this.heading('Paper');
    this.colorSetting('Background', this.draft.paper.color, (value) => {
      this.draft.paper.color = value;
    });
    new Setting(this.editorEl)
      .setName('Pattern')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            blank: 'Blank',
            ruled: 'Ruled',
            ledger: 'Ledger',
            'dot-grid': 'Dot grid',
            graph: 'Graph',
            'cross-hatch': 'Cross hatch',
            diagonal: 'Diagonal',
            hex: 'Hex',
            scallop: 'Scallop',
          })
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
    this.colorSetting('Callout accent', this.draft.blocks.calloutAccent, (value) => {
      this.draft.blocks.calloutAccent = value;
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
    this.heading('Library');
    this.folderSetting();
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

  private folderSetting(): void {
    const listId = `templar-template-folders-${String(Date.now())}`;
    const setting = new Setting(this.editorEl)
      .setName('Folder')
      .setDesc('Organize this style in the library or enter a new folder name.');
    setting.addText((text) => {
      text.inputEl.setAttribute('list', listId);
      text.inputEl.setAttribute('placeholder', 'Unfiled');
      text.setValue(this.draft.metadata.folder).onChange((next) => {
        this.draft.metadata.folder = next;
        void this.updatePreview();
      });
      text.inputEl.addEventListener('blur', () => {
        const normalized = normalizeTemplateFolder(text.inputEl.value);
        text.setValue(normalized);
        this.draft.metadata.folder = normalized;
      });
    });
    const folders = new Set(this.plugin.library.folders());
    folders.add(normalizeTemplateFolder(this.draft.metadata.folder));
    const dataList = this.editorEl.createEl('datalist', { attr: { id: listId } });
    for (const folder of folders) {
      dataList.createEl('option', { attr: { value: folder } });
    }
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
  ): Setting {
    const setting = new Setting(this.editorEl)
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
    return setting;
  }

  private async updatePreview(): Promise<void> {
    const version = ++this.previewVersion;
    const normalized = normalizeTemplate(this.draft);
    normalized.id = this.originalId ?? slugify(this.draft.name);
    normalized.name = this.draft.name;
    normalized.metadata = {
      ...clone(this.draft.metadata),
      folder: normalizeTemplateFolder(this.draft.metadata.folder),
    };
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

  private async resetToDefault(): Promise<void> {
    if (!this.sourceBuiltInId) {
      return;
    }
    const pristine = BUILT_IN_TEMPLATES.find(
      (template) => template.id === this.sourceBuiltInId,
    );
    if (!pristine) {
      new Notice('The built-in style is no longer available.');
      return;
    }
    const overrides = this.plugin.library
      .userTemplates()
      .filter(
        (template) =>
          template.id === `${this.sourceBuiltInId}-custom` ||
          template.id.startsWith(`${this.sourceBuiltInId}-custom-`),
      );
    const description = overrides.length > 0
      ? `The draft returns to the original “${pristine.name}” definition. This also removes ${overrides.map((template) => `“${template.name}”`).join(', ')} from your custom styles.`
      : `The draft returns to the original “${pristine.name}” definition. Any unsaved changes are discarded.`;
    new ConfirmationModal(
      this.plugin,
      `Reset “${pristine.name}” to its default?`,
      description,
      async () => {
        for (const override of overrides) {
          await this.plugin.library.remove(override.id);
        }
        this.draft = clone(pristine);
        this.draft.builtIn = false;
        this.plugin.refreshSidebars();
        this.renderEditor();
        new Notice(`“${pristine.name}” restored to its default.`);
      },
      'Reset to default',
    ).open();
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
    const styled = this.matchingFiles().filter((file) => this.plugin.frontmatter.hasStyle(file)).length;
    this.summaryEl.setText(`${String(count)} Markdown ${count === 1 ? 'note' : 'notes'} match: ${String(count - styled)} unstyled will receive the style; ${String(styled)} styled will be replaced.`);
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
      `${String(files.filter((file) => !this.plugin.frontmatter.hasStyle(file)).length)} unstyled notes will receive the style and ${String(files.filter((file) => this.plugin.frontmatter.hasStyle(file)).length)} styled notes will be replaced. Markdown and unrelated frontmatter remain unchanged.`,
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
          if (completed % 20 === 0) {
            await new Promise<void>((resolve) => this.contentEl.ownerDocument.defaultView?.setTimeout(resolve, 0));
          }
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
  return [
    ...validateTemplate(template).issues,
    ...validateCustomCss(template.css, {
      protectRhythm: template.baseline.enabled && template.baseline.mode !== 'free',
    }).issues,
  ];
}
