import { FuzzySuggestModal, type TFile } from 'obsidian';
import type TemplarPlugin from '../../main';
import type { TemplarTemplate } from '../../types';
import { runUserAction } from '../async-actions';
import { CreateStyledNoteModal } from './create-styled-note-modal';

export class StylePickerModal extends FuzzySuggestModal<TemplarTemplate> {
  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile | null,
    private readonly intent: 'apply' | 'create' = 'apply',
  ) {
    super(plugin.app);
    this.setPlaceholder('Choose a page style…');
  }

  public getItems(): TemplarTemplate[] {
    return this.plugin.library.all();
  }

  public getItemText(item: TemplarTemplate): string {
    const tags = item.metadata.tags.length > 0 ? ` · ${item.metadata.tags.join(', ')}` : '';
    return `${item.metadata.folder} · ${item.name} — ${item.metadata.description}${tags}`;
  }

  public onChooseItem(item: TemplarTemplate): void {
    if (this.intent === 'create') {
      new CreateStyledNoteModal(this.plugin, item).open();
    } else if (this.file) {
      runUserAction(() => this.plugin.applyTemplate(item, this.file), 'Could not apply the page style');
    }
  }
}
