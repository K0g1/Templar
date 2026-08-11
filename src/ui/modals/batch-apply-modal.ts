import { Modal, Notice, Setting, TFile, getAllTags } from 'obsidian';
import type TemplarPlugin from '../../main';
import { DEFAULT_PAGE_OPTIONS } from '../../templates/defaults';
import type { NotePageOptions } from '../../types';
import { clone } from '../../utils/value';
import { ConfirmationModal } from './confirmation-modal';

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
    const styled = files.filter((file) => this.plugin.frontmatter.hasStyle(file)).length;
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
        const results = await this.plugin.application.applyBatch(files, template, (_file, current) => {
          const page: NotePageOptions = clone(current?.page ?? { ...DEFAULT_PAGE_OPTIONS, mode: 'pageless' as const });
          if (this.pageMode !== 'preserve') page.mode = this.pageMode;
          if (this.pageMode === 'paged') {
            page.size = this.pageSize;
            page.width = this.pageSize === 'letter' ? 816 : 794;
            page.height = this.pageSize === 'letter' ? 1056 : 1123;
          }
          return page;
        });
        const succeeded = results.filter((result) => result.status === 'succeeded').length;
        const failed = results.filter((result) => result.status === 'failed');
        this.plugin.refreshSidebars();
        const failureText = failed.length > 0 ? ` Failed: ${failed.map((result) => result.path).join(', ')}.` : '';
        new Notice(`Applied “${template.name}” to ${String(succeeded)} of ${String(files.length)} notes.${failureText}`);
        this.close();
      },
    ).open();
  }
}
