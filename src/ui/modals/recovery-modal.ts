import { Modal, Notice, Setting, TFile, stringifyYaml } from 'obsidian';
import { CURRENT_TEMPLAR_FORMAT_VERSION } from '../../constants';
import type TemplarPlugin from '../../main';
import { authorizeRecoveryWrite, StaleTemplarDataError } from '../../services/frontmatter';
import type { NoteStyleInspection } from '../../services/style-inspection';
import { noteStyleToFrontmatter } from '../../templates/note-format';
import { writeTextToClipboard } from '../../utils/clipboard';
import { ConfirmationModal } from './confirmation-modal';
import { runButtonAction } from './shared';

export class RecoveryModal extends Modal {
  private replacementTemplateId: string;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly inspection: NoteStyleInspection,
  ) {
    super(plugin.app);
    this.replacementTemplateId = plugin.settings.defaultTemplateId;
  }

  public onOpen(): void {
    this.setTitle('Templar data recovery');
    this.modalEl.addClass('templar-modal', 'templar-recovery-modal');
    this.contentEl.createEl('p', { text: `Note: ${this.file.path}` });
    this.contentEl.createEl('p', { text: this.statusText() });
    this.contentEl.createEl('p', {
      text: `Raw schema version: ${this.inspection.rawVersion ?? 'unknown'}; current supported: ${String(CURRENT_TEMPLAR_FORMAT_VERSION)}`,
    });
    if (this.inspection.protectedPaths.length > 0) {
      this.contentEl.createEl('p', {
        cls: 'templar-validation-error',
        text: 'Source snapshot requires recovery. Page-only changes may preserve it, but replacement, removal, and synchronization cannot safely proceed without a recovery backup.',
      });
    }
    if (this.inspection.trace.length > 0) {
      this.contentEl.createEl('p', { text: `Migration: ${this.inspection.trace.map((step) => `${step.from} → ${step.to}`).join(', ')}` });
    }
    for (const issue of this.inspection.issues) this.contentEl.createEl('p', { cls: 'templar-validation-error', text: issue.message });

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const copy = actions.createEl('button', { text: 'Copy raw data' });
    copy.addEventListener('click', () => void runButtonAction(copy, async () => {
      await writeTextToClipboard(stringifyYaml({ templar: this.inspection.raw }), this.contentEl.ownerDocument);
      new Notice('Copied the raw templar data.');
    }));
    const backup = actions.createEl('button', { text: 'Export recovery copy' });
    backup.addEventListener('click', () => void runButtonAction(backup, async () => {
      const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, this.reason());
      new Notice(`Created a recovery copy at “${path}”.`);
    }));

    if (this.inspection.status === 'migrated' && this.inspection.style) {
      const copyMigrated = actions.createEl('button', { text: 'Copy migrated YAML' });
      copyMigrated.addEventListener('click', () => void runButtonAction(copyMigrated, async () => {
        await writeTextToClipboard(
          stringifyYaml({ templar: noteStyleToFrontmatter(this.inspection.style!) }),
          this.contentEl.ownerDocument,
        );
        new Notice('Copied migrated templar data.');
      }));
      const upgrade = actions.createEl('button', { cls: 'mod-cta', text: 'Upgrade stored data…' });
      upgrade.addEventListener('click', () => this.confirmUpgrade());
    }

    if (this.needsDestructiveRecovery()) {
      const templates: Record<string, string> = {};
      for (const template of this.plugin.library.all()) templates[template.id] = template.name;
      new Setting(this.contentEl)
        .setName('Replacement style')
        .setDesc('The selected style will replace the raw templar data only after a new recovery backup succeeds.')
        .addDropdown((dropdown) => dropdown.addOptions(templates).setValue(this.replacementTemplateId).onChange((value) => {
          this.replacementTemplateId = value;
        }));
      const replace = actions.createEl('button', { cls: 'mod-cta', text: 'Replace after recovery…' });
      replace.addEventListener('click', () => this.confirmReplace());
      const remove = actions.createEl('button', { text: 'Remove after recovery…' });
      remove.addEventListener('click', () => this.confirmRemove());
    }
    const close = actions.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
  }

  private statusText(): string {
    if (this.inspection.status === 'migrated') {
      return 'This note uses an older supported Templar format. Templar is rendering a migrated in-memory representation; the note has not been rewritten.';
    }
    if (this.inspection.status === 'unsupported-future') {
      return 'This note contains Templar data written by a newer version. This version will not replace it automatically.';
    }
    if (this.inspection.status === 'migration-failed') {
      return 'This note uses an older Templar format, but its migration could not be completed safely.';
    }
    if (this.inspection.status === 'unsupported-legacy') {
      return 'This note uses a Templar format that is older than this version can safely migrate.';
    }
    if (this.inspection.status === 'invalid') {
      return 'This note contains Templar data that cannot be safely interpreted.';
    }
    return 'This note contains protected synchronization data that cannot be safely replaced by ordinary operations.';
  }

  private needsDestructiveRecovery(): boolean {
    return (this.inspection.status !== 'current' && this.inspection.status !== 'migrated') ||
      this.inspection.protectedPaths.length > 0;
  }

  private confirmReplace(): void {
    const template = this.plugin.library.get(this.replacementTemplateId);
    if (!template) {
      new Notice('Choose an available replacement style first.');
      return;
    }
    new ConfirmationModal(
      this.plugin,
      `Replace Templar data in ${this.file.basename}?`,
      `Status: ${this.inspection.status}; raw version: ${this.inspection.rawVersion ?? 'unknown'}. Templar will create a recovery copy in “Templar Recovery” and then replace the raw Templar data with “${template.name}”.`,
      async () => this.replace(template.id),
      'Back up and replace',
    ).open();
  }

  private confirmRemove(): void {
    new ConfirmationModal(
      this.plugin,
      `Remove Templar data from ${this.file.basename}?`,
      `Status: ${this.inspection.status}; raw version: ${this.inspection.rawVersion ?? 'unknown'}. Templar will create a recovery copy in “Templar Recovery” before deleting only the templar frontmatter property.`,
      async () => this.remove(),
      'Back up and remove Templar data',
    ).open();
  }

  private confirmUpgrade(): void {
    new ConfirmationModal(
      this.plugin,
      `Upgrade stored Templar data in ${this.file.basename}?`,
      'Templar will create a recovery copy of the older raw data, then persist the migrated current-format representation. The Markdown body and unrelated frontmatter are not changed.',
      async () => this.upgrade(),
      'Back up and upgrade',
    ).open();
  }

  private async replace(templateId: string): Promise<void> {
    const template = this.plugin.library.get(templateId);
    if (!template) throw new Error('The selected replacement style is unavailable.');
    const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, 'manual-replace');
    try {
      await this.plugin.frontmatter.applyTemplate(this.file, template, undefined, undefined, {
        expectedRawFingerprint: this.inspection.fingerprint,
        recoveryAuthorization: authorizeRecoveryWrite(path, this.inspection.fingerprint),
      });
    } catch (error) {
      this.throwStaleAfterBackup(error, path);
    }
    new Notice(`Created a recovery copy at “${path}”.`);
    this.close();
  }

  private async remove(): Promise<void> {
    const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, 'manual-remove');
    try {
      await this.plugin.frontmatter.removeStyle(this.file, {
        expectedRawFingerprint: this.inspection.fingerprint,
        recoveryAuthorization: authorizeRecoveryWrite(path, this.inspection.fingerprint),
      });
    } catch (error) {
      this.throwStaleAfterBackup(error, path);
    }
    new Notice(`Created a recovery copy at “${path}”.`);
    this.close();
  }

  private async upgrade(): Promise<void> {
    if (!this.inspection.style) throw new Error('The migrated Templar data is unavailable.');
    const path = await this.plugin.recovery.backupNoteStyle(this.file, this.inspection, 'migration');
    try {
      await this.plugin.frontmatter.writeStyle(this.file, this.inspection.style, {
        expectedRawFingerprint: this.inspection.fingerprint,
        recoveryAuthorization: authorizeRecoveryWrite(path, this.inspection.fingerprint),
      });
    } catch (error) {
      this.throwStaleAfterBackup(error, path);
    }
    new Notice(`Created a recovery copy at “${path}” and upgraded the stored data.`);
    this.close();
  }

  private throwStaleAfterBackup(error: unknown, path: string): never {
    if (error instanceof StaleTemplarDataError) {
      throw new Error(`Templar created a recovery copy at “${path}”, but the note changed before replacement, so no note data was modified.`);
    }
    throw error;
  }

  private reason(): 'migration' | 'unsupported-future' | 'unsupported-legacy' | 'invalid' | 'migration-failed' {
    return this.inspection.status === 'unsupported-future' || this.inspection.status === 'unsupported-legacy'
      ? this.inspection.status
      : this.inspection.status === 'migration-failed' || this.inspection.status === 'migrated'
        ? 'migration'
        : 'invalid';
  }
}
