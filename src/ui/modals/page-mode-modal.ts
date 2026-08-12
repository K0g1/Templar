import { Modal, type TFile } from 'obsidian';
import type TemplarPlugin from '../../main';
import type { NotePageOptions, TemplarNoteStyle } from '../../types';
import { clone } from '../../utils/value';
import { renderPageOptionSettings, runButtonAction } from './shared';
import { reportSingleFileOperation } from '../async-actions';

export class PageModeModal extends Modal {
  private pageOptions: NotePageOptions;
  private readonly openingFingerprint: string;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    private readonly style: TemplarNoteStyle,
  ) {
    super(plugin.app);
    this.pageOptions = clone(style.page);
    this.openingFingerprint = plugin.frontmatter.inspect(file).fingerprint;
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
    const result = await this.plugin.application.patchPageOptions(this.file, this.pageOptions, 'immediate', {
      expectedRawFingerprint: this.openingFingerprint,
    });
    this.plugin.refreshSidebars();
    this.plugin.updateStatusBar();
    reportSingleFileOperation(result, `Changed ${this.file.basename} to ${this.pageOptions.mode} mode.`);
    this.close();
  }
}
