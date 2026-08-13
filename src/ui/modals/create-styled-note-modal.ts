import { Modal, Notice, Setting, TFolder, normalizePath } from 'obsidian';
import type TemplarPlugin from '../../main';
import { DEFAULT_PAGE_OPTIONS } from '../../templates/defaults';
import type { TemplarTemplate } from '../../types';
import { clone } from '../../utils/value';
import { ensureVaultFolderTree } from '../../utils/vault-folders';
import { renderPageOptionSettings, runButtonAction } from './shared';

export class CreateStyledNoteModal extends Modal {
  private pageOptions = clone(DEFAULT_PAGE_OPTIONS);
  private title = 'Untitled Templar note';
  private folder: string;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly template: TemplarTemplate,
  ) {
    super(plugin.app);
    this.folder = plugin.activeFile()?.parent?.path ?? '';
  }

  public onOpen(): void {
    this.setTitle(`New note — ${this.template.name}`);
    new Setting(this.contentEl)
      .setName('Note title')
      .addText((text) =>
        text.setValue(this.title).onChange((value) => {
          this.title = value.trim();
        }),
      );
    new Setting(this.contentEl)
      .setName('Folder')
      .setDesc('Vault-relative. A missing folder will be created.')
      .addText((text) =>
        text.setValue(this.folder).onChange((value) => {
          this.folder = value.trim();
        }),
      );
    renderPageOptionSettings(this.contentEl, this.pageOptions, () => undefined);
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const create = actions.createEl('button', { cls: 'mod-cta', text: 'Create styled note' });
    create.addEventListener('click', () => void runButtonAction(create, async () => this.createNote()));
  }

  private async createNote(): Promise<void> {
    const safeTitle = (this.title || 'Untitled Templar note').replace(/[\\/:*?"<>|]/g, '-');
    const folder = normalizePath(this.folder);
    if (folder) {
      const existing = this.app.vault.getAbstractFileByPath(folder);
      if (existing && !(existing instanceof TFolder)) {
        throw new Error(`“${folder}” is a file, not a folder.`);
      }
      if (!existing) {
        await ensureVaultFolderTree(this.app, folder);
      }
    }
    const base = normalizePath(folder ? `${folder}/${safeTitle}` : safeTitle);
    let path = `${base}.md`;
    let suffix = 2;
    while (this.app.vault.getAbstractFileByPath(path)) {
      path = `${base} ${String(suffix)}.md`;
      suffix += 1;
    }
    const file = await this.app.vault.create(path, '');
    await this.plugin.applyTemplate(this.template, file, this.pageOptions, { notify: false });
    await this.app.workspace.getLeaf(false).openFile(file);
    this.plugin.renderer.scheduleRefreshAll();
    this.plugin.refreshSidebars();
    new Notice(`Created ${file.path}.`);
    this.close();
  }
}
