import { Modal, Notice, TFile } from 'obsidian';
import type TemplarPlugin from '../../main';
import {
  mergeTemplateUpdate,
  replaceWithLatestTemplate,
  synchronizationStatus,
  type SynchronizationStatus,
} from '../../services/synchronization';
import type { TemplarNoteStyle, TemplarTemplate } from '../../types';
import { ConfirmationModal } from './confirmation-modal';

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
        : { ok: true as const, style: replaceWithLatestTemplate(item.style, item.source) };
      if (!style.ok) throw new Error(style.issues.map((issue) => issue.message).join(' ') || 'The update could not be merged.');
      await this.plugin.application.writeStyle(item.file, style.style, 'deferred');
      completed += 1;
      if (completed % 20 === 0) await new Promise<void>((resolve) => this.contentEl.ownerDocument.defaultView?.setTimeout(resolve, 0));
    }
    this.plugin.renderer.scheduleRefreshAll();
    this.plugin.refreshSidebars();
    new Notice(`Updated ${String(completed)} ${completed === 1 ? 'note' : 'notes'}.`);
    this.close();
  }
}
