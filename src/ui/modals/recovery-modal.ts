import { Modal, Notice, TFile, stringifyYaml } from 'obsidian';
import type TemplarPlugin from '../../main';
import type { NoteStyleInspection } from '../../services/style-inspection';
import { runButtonAction } from './shared';

export class RecoveryModal extends Modal {
  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly inspection: NoteStyleInspection,
  ) {
    super(plugin.app);
  }

  public onOpen(): void {
    this.setTitle('Templar data recovery');
    this.modalEl.addClass('templar-modal', 'templar-recovery-modal');
    this.contentEl.createEl('p', { text: `Note: ${this.file.path}` });
    this.contentEl.createEl('p', { text: `Status: ${this.inspection.status}` });
    this.contentEl.createEl('p', { text: `Raw schema version: ${this.inspection.rawVersion ?? 'unknown'}; current supported: 1` });
    if (this.inspection.trace.length > 0) {
      this.contentEl.createEl('p', { text: `Migration: ${this.inspection.trace.map((step) => `${step.from} → ${step.to}`).join(', ')}` });
    }
    for (const issue of this.inspection.issues) this.contentEl.createEl('p', { cls: 'templar-validation-error', text: issue.message });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const copy = actions.createEl('button', { text: 'Copy raw data' });
    copy.addEventListener('click', () => void runButtonAction(copy, async () => {
      await navigator.clipboard?.writeText(stringifyYaml({ templar: this.inspection.raw }));
      new Notice('Copied the raw templar data.');
    }));
    const backup = actions.createEl('button', { text: 'Export recovery copy' });
    backup.addEventListener('click', () => void runButtonAction(backup, async () => {
      const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, this.reason());
      new Notice(`Created a recovery copy at “${path}”.`);
    }));
    if (this.inspection.status !== 'current' && this.inspection.status !== 'migrated') {
      const replace = actions.createEl('button', { cls: 'mod-cta', text: 'Replace with default style' });
      replace.addEventListener('click', () => void runButtonAction(replace, async () => {
        const template = this.plugin.library.get(this.plugin.settings.defaultTemplateId);
        if (!template) throw new Error('The default Templar style is unavailable.');
        const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, 'manual-replace');
        await this.plugin.frontmatter.applyTemplate(this.file, template, undefined, undefined, {
          expectedRawFingerprint: this.inspection.fingerprint,
          protectedDataPolicy: 'allow-after-recovery',
        });
        new Notice(`Created a recovery copy at “${path}”.`);
        this.close();
      }));
      const remove = actions.createEl('button', { text: 'Remove templar data' });
      remove.addEventListener('click', () => void runButtonAction(remove, async () => {
        const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, 'manual-remove');
        await this.plugin.frontmatter.removeStyle(this.file, {
          expectedRawFingerprint: this.inspection.fingerprint,
          protectedDataPolicy: 'allow-after-recovery',
        });
        new Notice(`Created a recovery copy at “${path}”.`);
        this.close();
      }));
    }
    const close = actions.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
  }

  private reason(): 'migration' | 'unsupported-future' | 'unsupported-legacy' | 'invalid' | 'migration-failed' {
    return this.inspection.status === 'unsupported-future' || this.inspection.status === 'unsupported-legacy'
      ? this.inspection.status
      : this.inspection.status === 'migration-failed' ? 'migration-failed' : 'invalid';
  }
}
