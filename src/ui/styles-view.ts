import { ItemView, Notice, type WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_ICON, TEMPLAR_VIEW_TYPE } from '../constants';
import type TemplarPlugin from '../main';
import { templateFolderKey } from '../templates/schema';
import type { TemplarTemplate } from '../types';
import { ConfirmationModal } from './modals';

type LibraryTab = 'favorites' | 'built-in' | 'custom';

function sameFolder(left: string, right: string): boolean {
  return templateFolderKey(left) === templateFolderKey(right);
}

export class TemplarStylesView extends ItemView {
  private activeTab: LibraryTab = 'favorites';
  private activeFolder: string | null = null;
  private searchQuery = '';
  private catalogSnapshot: TemplarTemplate[] = [];
  private tabTemplates: TemplarTemplate[] = [];
  private favouriteIds = new Set<string>();
  private favouriteCountEl: HTMLElement | null = null;
  private resultsEl: HTMLElement | null = null;
  private searchInputEl: HTMLInputElement | null = null;
  private searchFrame: number | null = null;
  private tabFolders: string[] = [];
  private tabFolderCounts = new Map<string, number>();
  private searchHaystacks = new Map<string, string>();

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
    this.cancelSearchFrame();
    this.contentEl.empty();
  }

  public render(): void {
    this.cancelSearchFrame();
    const container = this.contentEl;
    container.empty();
    this.catalogSnapshot = this.plugin.library.all();
    const catalogIds = new Set(this.catalogSnapshot.map((template) => template.id));
    this.favouriteIds = new Set(
      this.plugin.settings.favouriteTemplateIds.filter((id) => catalogIds.has(id)),
    );
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

    this.renderTabs(container, this.catalogSnapshot);
    this.renderTabContent(container, this.catalogSnapshot);
  }

  private renderTabs(container: HTMLElement, catalog: TemplarTemplate[]): void {
    const builtIns = catalog.filter((template) => template.builtIn);
    const userTemplates = catalog.filter((template) => !template.builtIn);
    const favouriteCount = catalog.filter((template) => this.favouriteIds.has(template.id)).length;
    const tabs = [
      { id: 'favorites' as const, label: 'Favorites', count: favouriteCount },
      { id: 'built-in' as const, label: 'Built-in styles', count: builtIns.length },
      { id: 'custom' as const, label: 'My custom styles', count: userTemplates.length },
    ];
    const tabRow = container.createDiv({ cls: 'templar-library-tabs' });
    tabRow.setAttribute('aria-label', 'Page style library sections');
    for (const tab of tabs) {
      const button = tabRow.createEl('button', {
        cls: this.activeTab === tab.id ? 'is-active' : undefined,
        attr: {
          'aria-pressed': String(this.activeTab === tab.id),
        },
      });
      button.createSpan({ text: tab.label });
      const count = button.createSpan({
        cls: 'templar-tab-count',
        text: String(tab.count),
      });
      if (tab.id === 'favorites') {
        this.favouriteCountEl = count;
      }
      button.addEventListener('click', () => {
        this.activeTab = tab.id;
        this.activeFolder = null;
        this.render();
      });
    }
  }

  private renderTabContent(container: HTMLElement, catalog: TemplarTemplate[]): void {
    const templates = this.templatesForActiveTab(catalog);
    this.tabTemplates = templates;
    this.indexTabTemplates();
    const browser = container.createDiv({ cls: 'templar-library-browser' });
    const searchRow = browser.createDiv({ cls: 'templar-library-search' });
    const search = searchRow.createEl('input', {
      attr: {
        type: 'search',
        placeholder: 'Search styles, folders, or tags…',
        'aria-label': 'Search page styles',
      },
    });
    search.value = this.searchQuery;
    this.searchInputEl = search;
    const clearSearch = searchRow.createEl('button', {
      cls: 'clickable-icon',
      attr: { 'aria-label': 'Clear style search', title: 'Clear search' },
      text: '×',
    });
    clearSearch.disabled = this.searchQuery.length === 0;
    const results = browser.createDiv({ cls: 'templar-library-results' });
    this.resultsEl = results;
    const updateResults = (): void => {
      results.empty();
      clearSearch.disabled = this.searchQuery.length === 0;
      this.renderBrowserResults(results, this.tabTemplates);
    };
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim();
      this.cancelSearchFrame();
      const frameWindow = search.ownerDocument.defaultView;
      if (!frameWindow) {
        updateResults();
        return;
      }
      this.searchFrame = frameWindow.requestAnimationFrame(() => {
        this.searchFrame = null;
        updateResults();
      });
    });
    clearSearch.addEventListener('click', () => {
      this.cancelSearchFrame();
      this.searchQuery = '';
      search.value = '';
      search.focus();
      updateResults();
    });
    updateResults();
  }

  private renderBrowserResults(
    container: HTMLElement,
    templates: TemplarTemplate[],
  ): void {
    if (templates.length === 0) {
      this.renderEmptyState(container);
      return;
    }

    const folders = this.tabFolders;
    if (this.activeFolder && !folders.some((folder) => sameFolder(folder, this.activeFolder!))) {
      this.activeFolder = null;
    }
    const folderNavigation = container.createDiv({ cls: 'templar-folder-navigation' });
    folderNavigation.createDiv({ cls: 'templar-section-label', text: 'Folders' });
    const folderButtons = folderNavigation.createDiv({ cls: 'templar-folder-buttons' });
    this.renderFolderButton(folderButtons, null, 'All styles', templates.length);
    for (const folder of folders) {
      this.renderFolderButton(
        folderButtons,
        folder,
        folder,
        this.tabFolderCounts.get(folder) ?? 0,
      );
    }

    const query = this.searchQuery.toLocaleLowerCase();
    if (!this.activeFolder && !query) {
      const overview = container.createDiv({ cls: 'templar-folder-overview' });
      overview.setAttribute('aria-label', 'Template folders');
      for (const folder of folders) {
        const tile = overview.createEl('button', { cls: 'templar-folder-tile' });
        tile.createSpan({ cls: 'templar-folder-tile-name', text: folder });
        const count = this.tabFolderCounts.get(folder) ?? 0;
        tile.createSpan({
          cls: 'templar-folder-tile-count',
          text: `${String(count)} ${count === 1 ? 'style' : 'styles'}`,
        });
        tile.addEventListener('click', () => this.selectFolder(folder));
      }
      return;
    }
    const visible = templates.filter((template) => {
      if (this.activeFolder && !sameFolder(template.metadata.folder, this.activeFolder)) {
        return false;
      }
      if (!query) {
        return true;
      }
      return this.searchHaystacks.get(template.id)?.includes(query) ?? false;
    });

    const summary = container.createDiv({ cls: 'templar-library-summary' });
    summary.setAttribute('aria-live', 'polite');
    summary.setText(
      `${String(visible.length)} ${visible.length === 1 ? 'style' : 'styles'}` +
        (this.activeFolder ? ` in ${this.activeFolder}` : ''),
    );
    if (visible.length === 0) {
      const empty = container.createDiv({ cls: 'templar-library-empty templar-library-empty--search' });
      empty.createDiv({ cls: 'templar-library-empty-title', text: 'No styles found' });
      empty.createEl('p', {
        text: 'Try another search, choose a different folder, or clear the filters.',
      });
      const clear = empty.createEl('button', { text: 'Clear filters' });
      clear.addEventListener('click', () => {
        this.clearFilters();
      });
      return;
    }

    const visibleFolders = this.activeFolder
      ? [this.activeFolder]
      : this.plugin.library.folders(visible);
    for (const folder of visibleFolders) {
      const folderTemplates = visible
        .filter((template) => sameFolder(template.metadata.folder, folder))
        .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));
      if (folderTemplates.length === 0) {
        continue;
      }
      const section = container.createDiv({ cls: 'templar-folder-section' });
      const heading = section.createDiv({ cls: 'templar-folder-heading' });
      heading.createEl('h3', { cls: 'templar-folder-title', text: folder });
      heading.createDiv({ cls: 'templar-folder-count', text: String(folderTemplates.length) });
      const grid = section.createDiv({ cls: 'templar-style-grid' });
      for (const template of folderTemplates) {
        this.renderTemplateCard(grid, template);
      }
    }
  }

  private renderFolderButton(
    container: HTMLElement,
    folder: string | null,
    label: string,
    count: number,
  ): void {
    const button = container.createEl('button', {
      cls: this.activeFolder === folder ? 'is-active' : undefined,
      attr: { 'aria-pressed': String(this.activeFolder === folder), title: label },
    });
    button.createSpan({ cls: 'templar-folder-button-label', text: label });
    button.createSpan({ cls: 'templar-folder-button-count', text: String(count) });
    button.addEventListener('click', () => {
      this.selectFolder(folder);
    });
  }

  private indexTabTemplates(): void {
    this.tabFolders = this.plugin.library.folders(this.tabTemplates);
    this.tabFolderCounts.clear();
    this.searchHaystacks.clear();
    for (const template of this.tabTemplates) {
      const folder = this.tabFolders.find((candidate) =>
        sameFolder(candidate, template.metadata.folder)
      ) ?? template.metadata.folder;
      this.tabFolderCounts.set(
        folder,
        (this.tabFolderCounts.get(folder) ?? 0) + 1,
      );
      this.searchHaystacks.set(
        template.id,
        [
          template.name,
          template.metadata.description,
          template.metadata.author,
          template.metadata.folder,
          ...template.metadata.tags,
        ].join('\n').toLocaleLowerCase(),
      );
    }
  }

  private selectFolder(folder: string | null): void {
    this.activeFolder = folder;
    if (!this.resultsEl) {
      return;
    }
    this.resultsEl.empty();
    this.renderBrowserResults(this.resultsEl, this.tabTemplates);
  }

  private clearFilters(): void {
    this.cancelSearchFrame();
    this.searchQuery = '';
    this.activeFolder = null;
    if (this.searchInputEl) {
      this.searchInputEl.value = '';
      this.searchInputEl.focus();
    }
    this.selectFolder(null);
  }

  private cancelSearchFrame(): void {
    if (this.searchFrame === null) {
      return;
    }
    this.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.searchFrame);
    this.searchFrame = null;
  }

  private templatesForActiveTab(
    catalog: TemplarTemplate[] = this.catalogSnapshot,
  ): TemplarTemplate[] {
    if (this.activeTab === 'built-in') {
      return catalog.filter((template) => template.builtIn);
    }
    if (this.activeTab === 'custom') {
      return catalog.filter((template) => !template.builtIn);
    }
    return catalog.filter((template) => this.favouriteIds.has(template.id));
  }

  private renderEmptyState(container: HTMLElement): void {
    const empty = container.createDiv({ cls: 'templar-library-empty' });
    const title = this.activeTab === 'favorites'
      ? 'Your favorites will live here'
      : this.activeTab === 'custom'
        ? 'Make the library your own'
        : 'No built-in styles available';
    const description = this.activeTab === 'favorites'
      ? 'Select the star on any style to keep it close at hand.'
      : this.activeTab === 'custom'
        ? 'Create a style from scratch, import one, or customize a built-in.'
        : 'Reinstall Templar to restore the built-in collection.';
    empty.createDiv({ cls: 'templar-library-empty-title', text: title });
    empty.createEl('p', { text: description });
    if (this.activeTab === 'custom') {
      const create = empty.createEl('button', { cls: 'mod-cta', text: 'Create a style' });
      create.addEventListener('click', () => this.plugin.showTemplateCreator());
    }
  }

  private renderTemplateCard(container: HTMLElement, template: TemplarTemplate): void {
    const card = container.createDiv({ cls: 'templar-style-card' });
    const swatch = card.createDiv({ cls: 'templar-style-swatch' });
    swatch.style.setProperty('--templar-swatch-paper', template.paper.color);
    swatch.style.setProperty('--templar-swatch-line', template.paper.patternColor);
    swatch.style.setProperty('--templar-swatch-major', template.paper.majorPatternColor);
    swatch.style.setProperty('--templar-swatch-margin', template.paper.marginColor);
    swatch.dataset.pattern = template.paper.pattern;
    const favourite = swatch.createEl('button', {
      cls: `templar-favourite-toggle${this.favouriteIds.has(template.id) ? ' is-active' : ''}`,
      attr: {
        'aria-label': `${this.favouriteIds.has(template.id) ? 'Remove' : 'Add'} ${template.name} ${this.favouriteIds.has(template.id) ? 'from' : 'to'} favorites`,
        'aria-pressed': String(this.favouriteIds.has(template.id)),
      },
      text: '★',
    });
    favourite.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void this.toggleFavourite(template.id).then((isFavourite) => {
        favourite.toggleClass('is-active', isFavourite);
        favourite.setAttribute('aria-pressed', String(isFavourite));
        favourite.setAttribute(
          'aria-label',
          `${isFavourite ? 'Remove' : 'Add'} ${template.name} ${isFavourite ? 'from' : 'to'} favorites`,
        );
      });
    });
    card.createDiv({ cls: 'templar-style-name', text: template.name });
    card.createDiv({ cls: 'templar-folder-badge', text: template.metadata.folder });
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

  private async toggleFavourite(id: string): Promise<boolean> {
    const isFavourite = await this.plugin.library.toggleFavourite(id);
    if (isFavourite) {
      this.favouriteIds.add(id);
    } else {
      this.favouriteIds.delete(id);
    }
    if (this.favouriteCountEl) {
      this.favouriteCountEl.setText(String(this.favouriteIds.size));
    }
    new Notice(isFavourite ? 'Added to favorites.' : 'Removed from favorites.');
    if (this.activeTab === 'favorites' && this.resultsEl) {
      this.tabTemplates = this.templatesForActiveTab();
      this.indexTabTemplates();
      this.resultsEl.empty();
      this.renderBrowserResults(this.resultsEl, this.tabTemplates);
    }
    return isFavourite;
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
