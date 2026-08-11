import { Modal, type TFile } from 'obsidian';
import type TemplarPlugin from '../../main';
import { DEFAULT_PAGE_OPTIONS } from '../../templates/defaults';
import type { NotePageOptions, TemplarTemplate } from '../../types';
import { clone } from '../../utils/value';
import { renderPageOptionSettings, runButtonAction } from './shared';

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
