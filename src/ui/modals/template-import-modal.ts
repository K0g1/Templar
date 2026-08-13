import {
  Modal,
  Notice,
  Setting,
  parseYaml,
} from 'obsidian';
import {
  MAX_IMPORT_BYTES,
} from '../../constants';
import type TemplarPlugin from '../../main';
import {
  parseTemplatePack,
  type PackReview,
} from '../../services/template-pack';
import {
  parsedObjectToTemplate,
} from '../../templates/note-format';
import {
  inspectTemplateSchema,
} from '../../templates/schema';
import {
  validateCompleteTemplate,
} from '../../templates/validation';
import type {
  TemplarTemplate,
} from '../../types';
import {
  clone,
} from '../../utils/value';
import {
  renderIssues,
} from '../issues';
import {
  runButtonAction,
  stripCodeFence,
} from './shared';
import { renderTemplatePreview } from '../template-preview';
import { runUserAction } from '../async-actions';

/* The class is kept in its focused modal module; shared UI helpers live in ./shared. */
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
  private readonly conflictControls = new Map<number, HTMLSelectElement>();
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
    validateButton.addEventListener('click', () => runUserAction(() => this.validateInput(), 'Could not validate the import'));
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
    this.conflictControls.clear();
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
      const inspected = inspectTemplateSchema(parsed);
      if (!inspected.value) {
        renderIssues(this.validationEl, inspected.issues.map((issue) => ({
          severity: 'error' as const,
          path: 'schema',
          message: issue.message,
        })));
        return;
      }
      const template = parsedObjectToTemplate(inspected.value);
      template.builtIn = false;
      const issues = [
        ...validateCompleteTemplate(template),
        ...(inspected.status === 'migrated' ? [{
          severity: 'suggestion' as const,
          path: 'version',
          message: `This template was migrated in memory from format v${String(inspected.rawVersion)} to v1. Saving will write the current v1 format.`,
        }] : []),
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
      const plan = [...this.packSelection].flatMap((index) => {
        const review = this.packReview?.templates[index];
        if (!review?.valid) return [];
        const incoming = clone(review.template);
        const existing = this.plugin.library.get(incoming.id);
        const selected = this.conflictChoices.get(index) ?? 'keep';
        const action = !existing
          ? 'copy' as const
          : selected === 'replace' && !existing.builtIn
            ? 'replace' as const
            : selected === 'copy' || (selected === 'replace' && existing.builtIn)
              ? 'copy' as const
              : 'keep' as const;
        return [{ template: incoming, action }];
      });
      const saved = await this.plugin.library.importMany(plan);
      const imported = saved.imported.length;
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
      preview.addEventListener('click', () => runUserAction(
        () => renderTemplatePreview(detailPreview, entry.template, this.plugin.fontMetrics),
        'Could not render the template preview',
      ));
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
              const propagated = choice === 'replace' && remainingExisting.builtIn ? 'copy' : choice;
              this.conflictChoices.set(remaining, propagated);
              const remainingControl = this.conflictControls.get(remaining);
              if (remainingControl) remainingControl.value = propagated;
            }
          }
        });
        this.conflictChoices.set(index, 'keep');
        this.conflictControls.set(index, conflict);
      }
    });
    this.updatePackSaveButton();
  }

  private updatePackSaveButton(): void {
    this.saveButton.disabled = this.packSelection.size === 0;
    this.saveButton.setText(`Import ${String(this.packSelection.size)} ${this.packSelection.size === 1 ? 'style' : 'styles'}`);
  }
}
