import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_ICON, TEMPLAR_VIEW_TYPE } from '../constants';
import type TemplarPlugin from '../main';
import type { TemplarTemplate } from '../types';
import { ConfirmationModal } from './modals';

type LibraryTab = 'favorites' | 'built-in' | 'custom';

export class TemplarStylesView extends ItemView {
  private activeTab: LibraryTab = 'favorites';

  public constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: TemplarPlugin,
  ) {
    super(leaf);
  }

  public getViewType(): string {
    return TEMPLAR_VIEW_TYPE;
  }

  public getDisplayText(): string {
    return 'Page styles';
  }

  public getIcon(): string {
    return TEMPLAR_ICON;
  }

  public async onOpen(): Promise<void> {
    this.contentEl.addClass('templar-styles-view');
    this.render();
  }

  public async onClose(): Promise<void> {
    this.contentEl.empty();
  }

  public render(): void {
    const container = this.contentEl;
    container.empty();
    container.createDiv({ cls: 'templar-view-title', text: 'Page Styles' });

    const file = this.plugin.activeFile();
    const currentStyle = file ? this.plugin.frontmatter.getStyle(file) : null;
    const noteCard = container.createDiv({ cls: 'templar-current-note' });
    noteCard.createDiv({ cls: 'templar-section-label', text: 'Current note' });
    noteCard.createDiv({
      cls: 'templar-current-note-name',
      text: file?.basename ?? 'No Markdown note open',
    });
    noteCard.createDiv({
      cls: 'templar-current-style-name',
      text: currentStyle
        ? `${currentStyle.name} · ${currentStyle.page.mode}`
        : 'Normal Obsidian appearance',
    });
    if (file && currentStyle) {
      const controls = noteCard.createDiv({ cls: 'templar-inline-actions' });
      const edit = controls.createEl('button', { text: 'Edit raw' });
      edit.addEventListener('click', () => this.plugin.showRawStyleEditor(file));
      const pageMode = controls.createEl('button', { text: 'Page mode' });
      pageMode.addEventListener('click', () => this.plugin.showPageMode(file));
      const remove = controls.createEl('button', { text: 'Remove style' });
      remove.addEventListener('click', () => void this.plugin.removeStyle(file));
    }

    const toolbar = container.createDiv({ cls: 'templar-view-toolbar' });
    const create = toolbar.createEl('button', { text: 'Create' });
    create.addEventListener('click', () => this.plugin.showTemplateCreator());
    const newNote = toolbar.createEl('button', { cls: 'mod-cta', text: 'New styled note' });
    newNote.addEventListener('click', () => this.plugin.showNewNoteStylePicker());
    const importButton = toolbar.createEl('button', { text: 'Import' });
    importButton.addEventListener('click', () => this.plugin.showTemplateImporter());
    const batch = toolbar.createEl('button', { text: 'Batch apply' });
    batch.addEventListener('click', () => this.plugin.showBatchApply());

    this.renderTabs(container);
    this.renderTabContent(container);
  }

  private renderTabs(container: HTMLElement): void {
    const builtIns = this.plugin.library.builtIns();
    const userTemplates = this.plugin.library.userTemplates();
    const favouriteCount = [...builtIns, ...userTemplates].filter((template) =>
      this.plugin.library.isFavourite(template.id),
    ).length;
    const tabs = [
      { id: 'favorites' as const, label: 'Favorites', count: favouriteCount },
      { id: 'built-in' as const, label: 'Built-in styles', count: builtIns.length },
      { id: 'custom' as const, label: 'My custom styles', count: userTemplates.length },
    ];
    const tabRow = container.createDiv({ cls: 'templar-library-tabs' });
    for (const tab of tabs) {
      const button = tabRow.createEl('button', {
        cls: this.activeTab === tab.id ? 'is-active' : undefined,
        text: `${tab.label} (${String(tab.count)})`,
      });
      button.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.render();
      });
    }
  }

  private renderTabContent(container: HTMLElement): void {
    const templates =
      this.activeTab === 'built-in'
        ? this.plugin.library.builtIns()
        : this.activeTab === 'custom'
          ? this.plugin.library.userTemplates()
          : [...this.plugin.library.builtIns(), ...this.plugin.library.userTemplates()].filter(
              (template) => this.plugin.library.isFavourite(template.id),
            );
    if (templates.length === 0) {
      const empty = container.createDiv({ cls: 'templar-library-empty' });
      if (this.activeTab === 'favorites') {
        empty.setText('Star a style with the ★ button to keep it here.');
      } else if (this.activeTab === 'custom') {
        empty.setText('No custom styles yet. Use “create”, “import”, or “duplicate” on a built-in.');
      } else {
        empty.setText('No built-in styles available.');
      }
      return;
    }
    const grid = container.createDiv({ cls: 'templar-style-grid' });
    for (const template of templates) {
      this.renderTemplateCard(grid, template);
    }
  }

  private renderTemplateCard(container: HTMLElement, template: TemplarTemplate): void {
    const card = container.createDiv({ cls: 'templar-style-card' });
    const swatch = card.createDiv({ cls: 'templar-style-swatch' });
    swatch.style.setProperty('--templar-swatch-paper', template.paper.color);
    swatch.style.setProperty('--templar-swatch-line', template.paper.patternColor);
    swatch.dataset.pattern = template.paper.pattern;
    const favourite = swatch.createEl('button', {
      cls: `templar-favourite-toggle${this.plugin.library.isFavourite(template.id) ? ' is-active' : ''}`,
      attr: { 'aria-label': 'Toggle favourite', 'aria-pressed': String(this.plugin.library.isFavourite(template.id)) },
      text: '★',
    });
    favourite.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.toggleFavourite(template.id);
    });
    card.createDiv({ cls: 'templar-style-name', text: template.name });
    card.createDiv({ cls: 'templar-style-description', text: template.metadata.description });

    const actions = card.createDiv({ cls: 'templar-card-actions' });
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply' });
    apply.disabled = this.plugin.activeFile() === null;
    apply.addEventListener('click', () => this.plugin.showApplyTemplate(template, this.plugin.activeFile()));

    const newNote = actions.createEl('button', { text: 'New note' });
    newNote.addEventListener('click', () => this.plugin.showCreateStyledNote(template));

    const customize = actions.createEl('button', {
      text: template.builtIn ? 'Customize' : 'Edit',
    });
    customize.addEventListener('click', () => void this.editTemplate(template));

    const more = card.createEl('details', { cls: 'templar-card-more' });
    more.createEl('summary', { text: 'More' });
    const moreActions = more.createDiv({ cls: 'templar-card-more-actions' });
    const duplicate = moreActions.createEl('button', { text: 'Duplicate' });
    duplicate.addEventListener('click', () => void this.duplicateTemplate(template));
    const exportButton = moreActions.createEl('button', { text: 'Export' });
    exportButton.addEventListener('click', () => void this.plugin.exportTemplate(template));
    if (!template.builtIn) {
      const deleteButton = moreActions.createEl('button', {
        cls: 'mod-warning',
        text: 'Delete from library',
      });
      deleteButton.addEventListener('click', () => this.confirmDelete(template));
    }
  }

  private async toggleFavourite(id: string): Promise<void> {
    const isFavourite = await this.plugin.library.toggleFavourite(id);
    new Notice(isFavourite ? 'Added to favorites.' : 'Removed from favorites.');
    this.render();
  }

  private async editTemplate(template: TemplarTemplate): Promise<void> {
    this.plugin.showTemplateCreator(template);
  }

  private async duplicateTemplate(template: TemplarTemplate): Promise<void> {
    const copy = await this.plugin.library.duplicate(template.id);
    new Notice(`Created “${copy.name}”.`);
    this.render();
  }

  private confirmDelete(template: TemplarTemplate): void {
    new ConfirmationModal(
      this.plugin,
      `Delete “${template.name}” from the library?`,
      'Notes that already use this style remain fully styled because their design is self-contained.',
      async () => {
        await this.plugin.library.remove(template.id);
        if (this.plugin.settings.defaultTemplateId === template.id) {
          this.plugin.settings.defaultTemplateId = 'classic-ruled';
          await this.plugin.saveSettings();
        }
        this.render();
        new Notice(`Deleted “${template.name}” from the library.`);
      },
      'Delete style',
    ).open();
  }
}
