import { Modal, Notice, Setting, TFile, getAllTags } from 'obsidian';
import type TemplarPlugin from '../../main';
import { DEFAULT_PAGE_OPTIONS } from '../../templates/defaults';
import type { NotePageOptions } from '../../types';
import { clone } from '../../utils/value';
import type { BatchApplyRequest } from '../../services/style-application';
import type { NoteStyleInspection } from '../../services/style-inspection';
import { mergeOperationResults, summarizeFileOperations, type BatchOperationSummary, type FileOperationResult } from '../../services/operation-result';
import { renderOperationSummary } from '../operation-results';
import { runUserAction } from '../async-actions';
import { ConfirmationModal } from './confirmation-modal';

export class BatchApplyModal extends Modal {
  private templateId: string;
  private targetScope: 'note' | 'folder' | 'tag' | 'vault' = 'folder';
  private pageMode: 'preserve' | 'pageless' | 'paged' = 'preserve';
  private pageSize: 'a4' | 'letter' = 'a4';
  private tag = '';
  private summaryEl!: HTMLElement;
  private resultsEl: HTMLElement | null = null;
  private aggregateResults: FileOperationResult[] = [];

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
    for (const template of this.plugin.library.all()) templates[template.id] = template.name;
    new Setting(this.contentEl)
      .setName('Page style')
      .addDropdown((dropdown) => dropdown.addOptions(templates).setValue(this.templateId).onChange((value) => {
        this.templateId = value;
        this.updateSummary();
      }));
    new Setting(this.contentEl)
      .setName('Apply to')
      .addDropdown((dropdown) => dropdown.addOptions({
        note: 'Current note', folder: 'Current folder (recursive)', tag: 'Notes with tag', vault: 'Entire vault',
      }).setValue(this.targetScope).onChange((value) => {
        this.targetScope = value as typeof this.targetScope;
        this.updateSummary();
      }));
    new Setting(this.contentEl)
      .setName('Page mode')
      .setDesc('Preserve keeps each styled note’s current mode and uses pageless for unstyled notes.')
      .addDropdown((dropdown) => dropdown.addOptions({ preserve: 'Preserve per note', pageless: 'Pageless', paged: 'Paged' }).setValue(this.pageMode).onChange((value) => {
        this.pageMode = value as typeof this.pageMode;
      }));
    new Setting(this.contentEl)
      .setName('Paged size')
      .setDesc('Used when page mode is set to paged.')
      .addDropdown((dropdown) => dropdown.addOptions({ a4: 'A4', letter: 'US Letter' }).setValue(this.pageSize).onChange((value) => {
        this.pageSize = value as typeof this.pageSize;
      }));
    new Setting(this.contentEl)
      .setName('Tag')
      .setDesc('Used only for the “notes with tag” scope. Include or omit #.')
      .addText((text) => text.setValue(this.tag).onChange((value) => {
        this.tag = value.trim();
        this.updateSummary();
      }));
    this.summaryEl = this.contentEl.createDiv({ cls: 'templar-batch-summary' });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const apply = actions.createEl('button', { cls: 'mod-warning', text: 'Review and apply…' });
    apply.addEventListener('click', () => this.confirm());
    this.updateSummary();
  }

  private matchingFiles(): TFile[] {
    const active = this.plugin.activeFile();
    const files = this.app.vault.getMarkdownFiles();
    if (this.targetScope === 'note') return active ? [active] : [];
    if (this.targetScope === 'folder') {
      if (!active) return [];
      const folder = active.parent?.path ?? '';
      return folder ? files.filter((file) => file.path.startsWith(`${folder}/`)) : files;
    }
    if (this.targetScope === 'tag') {
      const wanted = this.tag.replace(/^#/, '');
      if (!wanted) return [];
      return files.filter((file) => {
        const cache = this.app.metadataCache.getFileCache(file);
        const tags = cache ? getAllTags(cache) : null;
        return tags?.some((tag) => tag.replace(/^#/, '') === wanted) ?? false;
      });
    }
    return files;
  }

  private updateSummary(): void {
    if (!this.summaryEl) return;
    const files = this.matchingFiles();
    const count = files.length;
    const styled = files.filter((file) => this.plugin.frontmatter.inspect(file).status !== 'absent').length;
    this.summaryEl.setText(`${String(count)} Markdown ${count === 1 ? 'note' : 'notes'} match: ${String(count - styled)} unstyled will receive the style; ${String(styled)} existing or protected notes will be skipped.`);
  }

  private confirm(): void {
    const files = Object.freeze([...this.matchingFiles()]);
    const template = this.plugin.library.get(this.templateId);
    if (!template || files.length === 0) {
      new Notice('No matching notes or page style were found.');
      return;
    }

    const frozenTemplate = clone(template);
    this.aggregateResults = [];
    const frozenPageMode = this.pageMode;
    const frozenPageSize = this.pageSize;
    const request = Object.freeze({
      files,
      template: frozenTemplate,
      decide: (_file: TFile, inspection: NoteStyleInspection) => {
        if (inspection.status !== 'absent') {
          return { kind: 'skip' as const, message: 'Existing or protected Templar data was not overwritten.' };
        }
        const current = inspection.style;
        const page: NotePageOptions = clone(current?.page ?? { ...DEFAULT_PAGE_OPTIONS, mode: 'pageless' as const });
        if (frozenPageMode !== 'preserve') page.mode = frozenPageMode;
        if (frozenPageMode === 'paged') {
          page.size = frozenPageSize;
          page.width = frozenPageSize === 'letter' ? 816 : 794;
          page.height = frozenPageSize === 'letter' ? 1056 : 1123;
        }
        return { kind: 'apply' as const, pageOptions: page };
      },
      yieldToHost: () => new Promise<void>((resolve) => {
        const view = this.contentEl.ownerDocument.defaultView;
        if (view) view.setTimeout(resolve, 0);
        else resolve();
      }),
    }) satisfies BatchApplyRequest;

    const unstyled = files.filter((file) => this.plugin.frontmatter.inspect(file).status === 'absent').length;
    const styled = files.length - unstyled;
    new ConfirmationModal(
      this.plugin,
      `Apply “${frozenTemplate.name}” to ${String(files.length)} notes?`,
      `${String(unstyled)} unstyled notes will receive the style and ${String(styled)} existing or protected notes will be skipped. Markdown and unrelated frontmatter remain unchanged.`,
      async () => this.execute(request, frozenTemplate.name),
    ).open();
  }

  private async execute(request: BatchApplyRequest, templateName: string): Promise<void> {
    const summary = await this.plugin.application.applyBatch(request);
    this.aggregateResults = this.aggregateResults.length === 0
      ? summary.results
      : mergeOperationResults(this.aggregateResults, summary.results);
    const aggregate = summarizeFileOperations(this.aggregateResults);
    this.plugin.refreshSidebars();
    if (aggregate.failed === 0 && aggregate.warnings === 0 && aggregate.skipped === 0) {
      new Notice(`Applied “${templateName}” to ${String(aggregate.succeeded)} notes.`);
      this.close();
      return;
    }
    this.renderResults(request, templateName, aggregate);
  }

  private renderResults(request: BatchApplyRequest, templateName: string, summary: BatchOperationSummary): void {
    this.resultsEl?.remove();
    this.resultsEl = this.contentEl.createDiv({ cls: 'templar-operation-result-panel' });
    renderOperationSummary(this.resultsEl, summary, { showPaths: true });
    const actions = this.resultsEl.createDiv({ cls: 'modal-button-container' });
    if (summary.failed > 0) {
      const retry = actions.createEl('button', { cls: 'mod-cta', text: 'Retry failed' });
      retry.addEventListener('click', () => {
        const failedPaths = new Set(summary.results.filter((result) => result.status === 'failed').map((result) => result.path));
        const retryRequest: BatchApplyRequest = Object.freeze({
          ...request,
          files: Object.freeze(request.files.filter((file) => failedPaths.has(file.path))),
        });
        runUserAction(() => this.execute(retryRequest, templateName), 'Could not retry the batch style operation');
      });
    }
    const close = actions.createEl('button', { text: 'Close' });
    close.addEventListener('click', () => this.close());
  }
}
