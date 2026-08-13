import { Modal, Setting } from 'obsidian';
import type TemplarPlugin from '../../main';
import type { TemplarTemplate } from '../../types';
import { runButtonAction } from './shared';

export class TemplatePackExportModal extends Modal {
  private readonly selected = new Set<string>();
  private name = 'Templar Style Pack';
  private author = '';
  private description = '';
  private tags = '';

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly templates: TemplarTemplate[] = plugin.library.all(),
  ) {
    super(plugin.app);
    for (const template of templates) this.selected.add(template.id);
    const folders = new Set(templates.map((template) => template.metadata.folder));
    if (folders.size === 1) this.name = `${[...folders][0]} Pack`;
  }

  public onOpen(): void {
    this.setTitle('Export template pack');
    this.modalEl.addClass('templar-modal', 'templar-pack-modal');
    new Setting(this.contentEl).setName('Pack name').addText((text) => text.setValue(this.name).onChange((value) => { this.name = value; }));
    new Setting(this.contentEl).setName('Author').addText((text) => text.setValue(this.author).onChange((value) => { this.author = value; }));
    new Setting(this.contentEl).setName('Description').addTextArea((text) => text.setValue(this.description).onChange((value) => { this.description = value; }));
    new Setting(this.contentEl).setName('Tags').setDesc('Optional, comma-separated pack tags.').addText((text) => text.setValue(this.tags).onChange((value) => { this.tags = value; }));
    this.contentEl.createEl('p', { text: `${String(this.templates.length)} styles available for this pack.` });
    const list = this.contentEl.createDiv({ cls: 'templar-pack-list' });
    for (const template of this.templates) {
      const label = list.createEl('label', { cls: 'templar-pack-entry' });
      const checkbox = label.createEl('input', { attr: { type: 'checkbox' } });
      checkbox.checked = true;
      checkbox.addEventListener('change', () => checkbox.checked ? this.selected.add(template.id) : this.selected.delete(template.id));
      label.createSpan({ text: `${template.name} · ${template.metadata.folder}` });
    }
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' });
    cancel.addEventListener('click', () => this.close());
    const exportButton = actions.createEl('button', { cls: 'mod-cta', text: 'Export pack' });
    exportButton.addEventListener('click', () => void runButtonAction(exportButton, async () => {
      const templates = this.templates.filter((template) => this.selected.has(template.id));
      if (templates.length === 0) throw new Error('Select at least one style.');
      const tags = this.tags.split(',').map((tag) => tag.trim()).filter(Boolean);
      await this.plugin.exportTemplatePack({ name: this.name, author: this.author, description: this.description, tags }, templates);
      this.close();
    }));
  }
}
