import { Modal } from 'obsidian';
import type TemplarPlugin from '../../main';
import { runButtonAction } from './shared';

export class ConfirmationModal extends Modal {
  public constructor(
    plugin: TemplarPlugin,
    private readonly title: string,
    private readonly message: string,
    private readonly confirm: () => Promise<void>,
    private readonly confirmLabel = 'Apply changes',
  ) {
    super(plugin.app);
  }

  public onOpen(): void {
    this.setTitle(this.title);
    this.contentEl.createEl('p', { text: this.message });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const confirm = actions.createEl('button', {
      cls: 'mod-warning',
      text: this.confirmLabel,
    });
    confirm.addEventListener('click', () => void runButtonAction(confirm, async () => {
      await this.confirm();
      this.close();
    }));
  }
}
