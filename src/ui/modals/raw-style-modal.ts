import { Modal, Notice, TFile, parseYaml, stringifyYaml } from 'obsidian';
import { MAX_IMPORT_BYTES } from '../../constants';
import type TemplarPlugin from '../../main';
import { normalizeNoteStyle, validateTemplateSource } from '../../templates/schema';
import { noteStyleToFrontmatter } from '../../templates/note-format';
import { validateCompleteTemplate } from '../../templates/validation';
import type { TemplarNoteStyle } from '../../types';
import { renderIssues } from '../issues';
import { runButtonAction, stripCodeFence } from './shared';

export class RawStyleModal extends Modal {
  private inputEl!: HTMLTextAreaElement;
  private validationEl!: HTMLElement;
  private readonly openingFingerprint: string;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly style: TemplarNoteStyle,
  ) {
    super(plugin.app);
    this.openingFingerprint = plugin.frontmatter.inspect(file).fingerprint;
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
    await this.plugin.application.writeStyle(this.file, style, 'immediate', {
      expectedRawFingerprint: this.openingFingerprint,
    });
    this.plugin.refreshSidebars();
    this.plugin.updateStatusBar();
    new Notice('Saved the note’s page style.');
    this.close();
  }
}
