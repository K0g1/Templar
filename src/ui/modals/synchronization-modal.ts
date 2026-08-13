import { Modal, Notice, TFile } from 'obsidian';
import type TemplarPlugin from '../../main';
import {
  mergeTemplateUpdate,
  replaceWithLatestTemplate,
  synchronizationStatus,
  type SynchronizationStatus,
} from '../../services/synchronization';
import type { FileOperationResult } from '../../services/operation-result';
import { mergeOperationResults, summarizeFileOperations } from '../../services/operation-result';
import { validateCompleteTemplate } from '../../templates/validation';
import type { TemplarNoteStyle, TemplarTemplate } from '../../types';
import { renderOperationSummary } from '../operation-results';
import { runUserAction } from '../async-actions';
import { ConfirmationModal } from './confirmation-modal';

interface SyncReviewItem {
  file: TFile;
  style: TemplarNoteStyle;
  source: TemplarTemplate | null;
  status: SynchronizationStatus;
  action: 'safe' | 'merge' | 'replace' | 'skip';
  reviewedFingerprint: string;
  protectedSourceSnapshot: boolean;
}

export class SynchronizationReviewModal extends Modal {
  private items: SyncReviewItem[] = [];
  private overview = { total: 0, upToDate: 0, localOnly: 0, safe: 0, modified: 0, legacy: 0, missing: 0 };
  private resultEl: HTMLElement | null = null;
  private retryableFailedPaths = new Set<string>();
  private aggregateResults: FileOperationResult[] = [];

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
      const inspection = this.plugin.frontmatter.inspect(file);
      const source = this.plugin.library.get(entry.style.sourceTemplateId ?? entry.style.id);
      const status = synchronizationStatus(entry.style, source);
      const protectedSourceSnapshot = inspection.protectedPaths.length > 0;
      const action: SyncReviewItem['action'] = protectedSourceSnapshot
        ? 'skip'
        : status.state === 'update-available'
        ? 'safe'
        : status.state === 'modified-update-available'
          ? 'merge'
          : 'skip';
      return [{ file, style: entry.style, source, status, action, reviewedFingerprint: inspection.fingerprint, protectedSourceSnapshot }];
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
    this.items = candidates.filter((item) => item.protectedSourceSnapshot || item.status.updateAvailable || item.status.state === 'source-missing');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.resultEl = null;
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
      row.createDiv({
        cls: 'templar-sync-state',
        text: item.protectedSourceSnapshot ? 'recovery required' : item.status.state.replace(/-/g, ' '),
      });
      const open = row.createEl('button', { text: 'Open note' });
      open.addEventListener('click', () => runUserAction(
        () => this.app.workspace.getLeaf(false).openFile(item.file),
        'Could not open the note',
      ));
      const choice = row.createEl('select', { attr: { 'aria-label': `Update choice for ${item.file.basename}` } });
      if (!item.protectedSourceSnapshot) {
        if (item.status.state === 'update-available') choice.createEl('option', { value: 'safe', text: 'Update safely' });
        if (item.status.state === 'modified-update-available') choice.createEl('option', { value: 'merge', text: 'Keep my changes where possible' });
        if (item.source) choice.createEl('option', { value: 'replace', text: 'Replace with latest' });
      }
      choice.createEl('option', { value: 'skip', text: item.status.legacy ? 'Keep current / skip' : 'Skip this note' });
      choice.value = item.action;
      choice.disabled = item.protectedSourceSnapshot;
      choice.addEventListener('change', () => { item.action = choice.value as SyncReviewItem['action']; });
      if (item.protectedSourceSnapshot) {
        row.createEl('p', { text: 'This note has a source snapshot that this version cannot safely interpret. Recover it before synchronizing.' });
        const recover = row.createEl('button', { text: 'Open recovery' });
        recover.addEventListener('click', () => this.plugin.showRecovery(item.file));
      }
      if (item.status.legacy) row.createEl('p', { text: 'Templar cannot reliably separate local changes from the original template for this older note.' });
    }
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const close = actions.createEl('button', { text: 'Cancel' });
    close.addEventListener('click', () => this.close());
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Review and update…' });
    apply.addEventListener('click', () => this.confirm());
  }

  private confirm(): void {
    this.aggregateResults = [];
    const counts = {
      safe: this.items.filter((item) => item.action === 'safe').length,
      merge: this.items.filter((item) => item.action === 'merge').length,
      replace: this.items.filter((item) => item.action === 'replace').length,
      skip: this.items.filter((item) => item.action === 'skip').length,
    };
    const selected = this.items.map((item) => ({ ...item }));
    new ConfirmationModal(this.plugin, 'Apply reviewed template updates?', `${String(counts.safe)} will update safely, ${String(counts.merge)} will merge local changes, ${String(counts.replace)} will be replaced, and ${String(counts.skip)} will be skipped.`, async () => this.execute(selected), 'Apply updates').open();
  }

  private async execute(selected: readonly SyncReviewItem[]): Promise<void> {
    this.retryableFailedPaths = new Set();
    const planned: Array<{ item: SyncReviewItem; style: TemplarNoteStyle; expectedRawFingerprint: string }> = [];
    const planningResults: FileOperationResult[] = [];
    let validationBlocked = false;

    for (const item of selected) {
      if (item.action === 'skip') {
        planningResults.push(skipped(item.file.path, 'Skipped by the selected action.'));
        continue;
      }
      const currentInspection = this.plugin.frontmatter.inspect(item.file);
      if (currentInspection.fingerprint !== item.reviewedFingerprint) {
        planningResults.push(skipped(item.file.path, "This note's Templar data changed while it was awaiting synchronization."));
        continue;
      }
      item.reviewedFingerprint = currentInspection.fingerprint;
      if (currentInspection.protectedPaths.length > 0) {
        planningResults.push(skipped(item.file.path, 'A protected source snapshot requires recovery before synchronization.'));
        continue;
      }
      if (!item.source) {
        planningResults.push(skipped(item.file.path, 'The source template is no longer available.'));
        continue;
      }
      const candidate = item.action === 'merge'
        ? mergeTemplateUpdate(item.style, item.source)
        : { ok: true as const, style: replaceWithLatestTemplate(item.style, item.source) };
      if (!candidate.ok) {
        validationBlocked = true;
        planningResults.push(failed(item.file.path, candidate.issues.map((issue) => issue.message).join(' ') || 'The update could not be merged.'));
        continue;
      }
      const issues = validateCompleteTemplate(candidate.style);
      const errors = issues.filter((issue) => issue.severity === 'error');
      if (errors.length > 0) {
        validationBlocked = true;
        planningResults.push(failed(item.file.path, errors.map((issue) => `${issue.path}: ${issue.message}`).join(' ')));
        continue;
      }
      planned.push({ item, style: candidate.style, expectedRawFingerprint: currentInspection.fingerprint });
    }

    if (validationBlocked) {
      for (const operation of planned) {
        planningResults.push(skipped(operation.item.file.path, 'Not written because another selected candidate failed validation.'));
      }
      this.aggregateResults = mergeOperationResults(this.aggregateResults, planningResults);
      this.renderResults(summarizeFileOperations(this.aggregateResults), selected);
      return;
    }

    const results = [...planningResults];
    let processed = 0;
    for (const operation of planned) {
      try {
        results.push(await this.plugin.application.writeStyle(operation.item.file, operation.style, 'deferred', {
          expectedRawFingerprint: operation.expectedRawFingerprint,
        }));
      } catch (error) {
        this.retryableFailedPaths.add(operation.item.file.path);
        results.push(failed(operation.item.file.path, errorMessage(error)));
      }
      processed += 1;
      if (processed % 20 === 0) {
        await new Promise<void>((resolve) => {
          const view = this.contentEl.ownerDocument.defaultView;
          if (view) view.setTimeout(resolve, 0);
          else resolve();
        });
      }
    }

    if (results.some((result) => result.noteWritten)) {
      try {
        this.plugin.renderer.scheduleRefreshAll();
      } catch (error) {
        addWarning(results, 'refresh', `The notes were written, but the final refresh failed: ${errorMessage(error)}`);
      }
      try {
        this.plugin.refreshSidebars();
      } catch (error) {
        addWarning(results, 'ui', `The notes were written, but the sidebar could not be refreshed: ${errorMessage(error)}`);
      }
    }

    this.aggregateResults = mergeOperationResults(this.aggregateResults, results);
    const summary = summarizeFileOperations(this.aggregateResults);
    if (summary.failed === 0 && summary.warnings === 0 && summary.skipped === 0) {
      new Notice(`Updated ${String(summary.succeeded)} ${summary.succeeded === 1 ? 'note' : 'notes'}.`);
      this.close();
      return;
    }
    this.renderResults(summary, selected);
  }

  private renderResults(summary: ReturnType<typeof summarizeFileOperations>, selected: readonly SyncReviewItem[]): void {
    this.resultEl?.remove();
    this.resultEl = this.contentEl.createDiv({ cls: 'templar-operation-result-panel' });
    renderOperationSummary(this.resultEl, summary, { showPaths: true });
    const actions = this.resultEl.createDiv({ cls: 'modal-button-container' });
    if (this.retryableFailedPaths.size > 0) {
      const retry = actions.createEl('button', { cls: 'mod-cta', text: 'Retry failed' });
      retry.addEventListener('click', () => {
        const retryItems = selected.filter((item) => this.retryableFailedPaths.has(item.file.path));
        runUserAction(() => this.execute(retryItems), 'Could not retry the template updates');
      });
    }
    const close = actions.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
  }
}

function skipped(path: string, message: string): FileOperationResult {
  return { path, status: 'skipped', noteWritten: false, refreshed: false, warnings: [], message };
}

function failed(path: string, message: string): FileOperationResult {
  return { path, status: 'failed', noteWritten: false, refreshed: false, warnings: [], message };
}

function addWarning(
  results: FileOperationResult[],
  stage: 'refresh' | 'ui',
  message: string,
): void {
  for (const result of results) {
    if (result.noteWritten) result.warnings.push({ stage, message });
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
