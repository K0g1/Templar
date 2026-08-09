import { ItemView, Menu, Notice, setIcon, type TFile, type WorkspaceLeaf } from 'obsidian';
import { TEMPLAR_ICON, TEMPLAR_VIEW_TYPE } from '../constants';
import type TemplarPlugin from '../main';
import { noteTemplateSnapshot, synchronizationStatus } from '../services/synchronization';
import { templateFolderKey } from '../templates/schema';
import type { LibraryDensity, TemplarTemplate } from '../types';
import { ConfirmationModal } from './modals';

type LibraryTab = 'recent' | 'favorites' | 'built-in' | 'custom';
type LibrarySort = 'name' | 'most-used';

function sameFolder(left: string, right: string): boolean {
  return templateFolderKey(left) === templateFolderKey(right);
}

export class TemplarStylesView extends ItemView {
  private readonly previewOwner = `styles-${Math.random().toString(36).slice(2)}`;
  private activeTab: LibraryTab = 'recent';
  private activeFolder: string | null = null;
  private searchQuery = '';
  private sort: LibrarySort = 'name';
  private selectedId: string | null = null;
  private visibleTemplates: TemplarTemplate[] = [];
  private cardEls: HTMLElement[] = [];
  private searchInputEl: HTMLInputElement | null = null;
  private searchFrame: number | null = null;

  public constructor(leaf: WorkspaceLeaf, private readonly plugin: TemplarPlugin) {
    super(leaf);
  }

  public getViewType(): string { return TEMPLAR_VIEW_TYPE; }
  public getDisplayText(): string { return 'Page styles'; }
  public getIcon(): string { return TEMPLAR_ICON; }

  public async onOpen(): Promise<void> {
    this.contentEl.addClass('templar-styles-view');
    this.contentEl.addEventListener('keydown', this.handleKeydown);
    this.render();
  }

  public async onClose(): Promise<void> {
    this.cancelSearchFrame();
    this.contentEl.removeEventListener('keydown', this.handleKeydown);
    await this.plugin.preview.cancel(this.previewOwner);
    this.contentEl.empty();
  }

  public focusSearch(): void {
    this.searchInputEl?.focus();
  }

  public previewNextFavourite(direction: 1 | -1): void {
    const favourites = this.plugin.settings.favouriteTemplateIds
      .map((id) => this.plugin.library.get(id))
      .filter((template): template is TemplarTemplate => template !== null);
    if (favourites.length === 0) {
      new Notice('Add a favorite style first.');
      return;
    }
    const activeFile = this.plugin.activeFile();
    const current = this.plugin.preview.current(this.previewOwner)?.templateId
      ?? (activeFile ? this.plugin.frontmatter.getStyle(activeFile)?.sourceTemplateId : undefined);
    const currentIndex = favourites.findIndex((template) => template.id === current);
    const nextIndex = currentIndex < 0
      ? direction === 1 ? 0 : favourites.length - 1
      : (currentIndex + direction + favourites.length) % favourites.length;
    this.previewTemplate(favourites[nextIndex]!);
  }

  public render(): void {
    this.cancelSearchFrame();
    this.plugin.ensureUsageIndex();
    const container = this.contentEl;
    container.empty();
    this.cardEls = [];
    container.createDiv({ cls: 'templar-view-title', text: 'Page Styles' });
    this.renderCurrentNote(container);
    this.renderToolbar(container);
    const catalog = this.plugin.library.all();
    this.renderTabs(container, catalog);
    this.renderLibrary(container, catalog);
  }

  private renderCurrentNote(container: HTMLElement): void {
    const file = this.plugin.activeFile();
    const style = file ? this.plugin.frontmatter.getStyle(file) : null;
    const preview = this.plugin.preview.current(this.previewOwner);
    const card = container.createDiv({ cls: `templar-current-note${preview ? ' is-previewing' : ''}` });
    card.createDiv({ cls: 'templar-section-label', text: preview ? 'Previewing' : 'Current note' });
    card.createDiv({ cls: 'templar-current-note-name', text: file?.basename ?? 'No Markdown note open' });
    if (preview) {
      card.createDiv({ cls: 'templar-current-style-name', text: preview.templateName });
      const actions = card.createDiv({ cls: 'templar-inline-actions' });
      const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply' });
      apply.addEventListener('click', () => void this.applyPreview());
      const cancel = actions.createEl('button', { text: 'Cancel preview' });
      cancel.addEventListener('click', () => void this.cancelPreview());
      return;
    }
    let stateText = style ? `${style.name} · ${style.page.mode}` : 'Normal Obsidian appearance';
    if (style) {
      const status = synchronizationStatus(style, this.plugin.library.get(style.sourceTemplateId ?? style.id));
      if (status.modified) stateText += ' · Modified';
      if (status.updateAvailable) stateText += ' · Update available';
      if (status.state === 'source-missing') stateText += ' · Source missing';
    }
    card.createDiv({ cls: 'templar-current-style-name', text: stateText });
    if (style?.provenance?.appliedByRule) {
      card.createDiv({ cls: 'templar-current-rule', text: `Applied automatically by rule: ${style.provenance.appliedByRule.name}` });
    }
    if (file && style) {
      const actions = card.createDiv({ cls: 'templar-inline-actions' });
      const customize = actions.createEl('button', { cls: 'mod-cta', text: 'Customize' });
      customize.addEventListener('click', () => this.plugin.showCurrentNoteInspector(file));
      const page = actions.createEl('button', { text: 'Page settings' });
      page.addEventListener('click', () => this.plugin.showPageMode(file));
      const more = actions.createEl('button', { attr: { 'aria-label': 'More current note actions', title: 'More actions' } });
      setIcon(more, 'more-horizontal');
      more.addEventListener('click', (event) => this.showCurrentNoteMenu(event, file));
    }
  }

  private renderToolbar(container: HTMLElement): void {
    const toolbar = container.createDiv({ cls: 'templar-view-toolbar' });
    const create = toolbar.createEl('button', { text: 'Create style' });
    create.addEventListener('click', () => this.plugin.showTemplateCreator());
    const newNote = toolbar.createEl('button', { text: 'New styled note' });
    newNote.addEventListener('click', () => this.plugin.showNewNoteStylePicker());
    const more = toolbar.createEl('button', { attr: { 'aria-label': 'More library actions', title: 'More library actions' } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', (event) => {
      const menu = new Menu();
      menu.addItem((item) => item.setTitle('Import style or pack…').setIcon('download').onClick(() => this.plugin.showTemplateImporter()));
      menu.addItem((item) => item.setTitle('Export selected styles…').setIcon('upload').onClick(() => this.plugin.showPackExporter()));
      menu.addItem((item) => item.setTitle('Review template updates').setIcon('refresh-cw').onClick(() => this.plugin.showSynchronizationReview()));
      menu.addItem((item) => item.setTitle('Batch apply…').setIcon('layers').onClick(() => this.plugin.showBatchApply()));
      menu.showAtMouseEvent(event);
    });
  }

  private renderTabs(container: HTMLElement, catalog: TemplarTemplate[]): void {
    const validIds = new Set(catalog.map((template) => template.id));
    const tabs: Array<{ id: LibraryTab; label: string; count: number }> = [
      { id: 'recent', label: 'Recent', count: this.plugin.settings.recentTemplateIds.filter((id) => validIds.has(id)).length },
      { id: 'favorites', label: 'Favorites', count: this.plugin.settings.favouriteTemplateIds.filter((id) => validIds.has(id)).length },
      { id: 'built-in', label: 'Built-in', count: catalog.filter((template) => template.builtIn).length },
      { id: 'custom', label: 'My Styles', count: catalog.filter((template) => !template.builtIn).length },
    ];
    const row = container.createDiv({ cls: 'templar-library-tabs', attr: { 'aria-label': 'Style library sections' } });
    for (const tab of tabs) {
      const button = row.createEl('button', { cls: this.activeTab === tab.id ? 'is-active' : undefined, attr: { 'aria-pressed': String(this.activeTab === tab.id) } });
      button.createSpan({ text: tab.label });
      button.createSpan({ cls: 'templar-tab-count', text: String(tab.count) });
      button.addEventListener('click', () => { this.activeTab = tab.id; this.activeFolder = null; this.render(); });
    }
  }

  private renderLibrary(container: HTMLElement, catalog: TemplarTemplate[]): void {
    const browser = container.createDiv({ cls: 'templar-library-browser' });
    const controls = browser.createDiv({ cls: 'templar-library-search' });
    const search = controls.createEl('input', { attr: { type: 'search', placeholder: 'Search styles…', 'aria-label': 'Search page styles' } });
    search.value = this.searchQuery;
    this.searchInputEl = search;
    search.addEventListener('input', () => {
      this.searchQuery = search.value.trim();
      this.cancelSearchFrame();
      const view = search.ownerDocument.defaultView;
      if (!view) return this.render();
      this.searchFrame = view.requestAnimationFrame(() => { this.searchFrame = null; this.render(); this.focusSearch(); });
    });
    const density = controls.createEl('select', { attr: { 'aria-label': 'Library density', title: 'Library density' } });
    for (const value of ['compact', 'comfortable', 'gallery'] as LibraryDensity[]) {
      density.createEl('option', { text: value[0]!.toUpperCase() + value.slice(1), value });
    }
    density.value = this.plugin.settings.libraryDensity;
    density.addEventListener('change', () => void this.setDensity(density.value as LibraryDensity));
    const sort = controls.createEl('select', { attr: { 'aria-label': 'Sort styles' } });
    sort.createEl('option', { value: 'name', text: 'Name' });
    sort.createEl('option', { value: 'most-used', text: 'Most used' });
    sort.value = this.sort;
    sort.addEventListener('change', () => { this.sort = sort.value as LibrarySort; this.render(); });
    const help = browser.createEl('details', { cls: 'templar-keyboard-help' });
    help.createEl('summary', { text: 'Keyboard help' });
    help.createEl('p', { text: '/ search · arrows navigate · space preview · enter apply · f favorite · escape cancels or clears one level' });

    let templates = this.templatesForTab(catalog);
    const folders = this.plugin.library.folders(templates);
    const filterRow = browser.createDiv({ cls: 'templar-folder-navigation' });
    const folderSelect = filterRow.createEl('select', { attr: { 'aria-label': 'Filter by style folder' } });
    folderSelect.createEl('option', { value: '', text: 'All folders' });
    for (const folder of folders) folderSelect.createEl('option', { value: folder, text: folder });
    folderSelect.value = this.activeFolder ?? '';
    folderSelect.addEventListener('change', () => { this.activeFolder = folderSelect.value || null; this.render(); });
    if (this.activeFolder) {
      const exportFolder = filterRow.createEl('button', { text: 'Export folder as pack' });
      exportFolder.addEventListener('click', () => this.plugin.showPackExporter(templates.filter((template) => sameFolder(template.metadata.folder, this.activeFolder!))));
    }

    const query = this.searchQuery.toLocaleLowerCase();
    templates = templates.filter((template) => {
      if (this.activeFolder && !sameFolder(template.metadata.folder, this.activeFolder)) return false;
      return !query || [template.name, template.metadata.folder, template.metadata.description, template.metadata.author, ...template.metadata.tags].join('\n').toLocaleLowerCase().includes(query);
    });
    if (this.sort === 'most-used') {
      templates.sort((a, b) => this.plugin.usageIndex.count(b.id) - this.plugin.usageIndex.count(a.id) || a.name.localeCompare(b.name));
    } else if (this.activeTab !== 'recent') {
      templates.sort((a, b) => a.name.localeCompare(b.name));
    }
    this.visibleTemplates = templates;
    const activeFolder = this.plugin.activeFile()?.parent?.path ?? '';
    const relevant = activeFolder ? templates.filter((template) => this.plugin.usageIndex.countInFolder(template.id, activeFolder) > 0) : [];
    const nearby = relevant.length;
    browser.createDiv({ cls: 'templar-library-summary', text: `${String(templates.length)} styles${nearby ? ` · ${String(nearby)} used in this folder` : ''}` });
    if (relevant.length > 0) {
      const nearbyRow = browser.createDiv({ cls: 'templar-folder-relevance' });
      nearbyRow.createSpan({ cls: 'templar-section-label', text: 'Used in this folder' });
      for (const template of relevant.slice(0, 6)) {
        const button = nearbyRow.createEl('button', { text: template.name });
        button.addEventListener('click', () => this.previewTemplate(template));
      }
    }
    const grid = browser.createDiv({ cls: `templar-style-grid density-${this.plugin.settings.libraryDensity}` });
    if (templates.length === 0) {
      grid.createDiv({ cls: 'templar-library-empty', text: 'No styles match this view.' });
      return;
    }
    if (!this.selectedId || !templates.some((template) => template.id === this.selectedId)) this.selectedId = templates[0]!.id;
    for (const template of templates) this.renderCard(grid, template);
  }

  private renderCard(container: HTMLElement, template: TemplarTemplate): void {
    const previewed = this.plugin.preview.current(this.previewOwner)?.templateId === template.id;
    const selected = this.selectedId === template.id;
    const card = container.createEl('article', {
      cls: `templar-style-card${selected ? ' is-selected' : ''}${previewed ? ' is-previewed' : ''}`,
      attr: { tabindex: selected ? '0' : '-1', 'aria-label': `${template.name}, ${template.metadata.folder}${previewed ? ', previewing' : ''}` },
    });
    card.dataset.templateId = template.id;
    this.cardEls.push(card);
    card.addEventListener('focus', () => { this.selectedId = template.id; this.updateRovingFocus(); });
    card.addEventListener('click', (event) => {
      if ((event.target as HTMLElement).closest('button, select, input')) return;
      this.selectedId = template.id;
      this.previewTemplate(template);
    });
    const swatch = card.createDiv({ cls: 'templar-style-swatch' });
    swatch.style.setProperty('--templar-swatch-paper', template.paper.color);
    swatch.style.setProperty('--templar-swatch-line', template.paper.patternColor);
    swatch.style.setProperty('--templar-swatch-major', template.paper.majorPatternColor);
    swatch.style.setProperty('--templar-swatch-margin', template.paper.marginColor);
    swatch.dataset.pattern = template.paper.pattern;
    const favorite = swatch.createEl('button', { cls: `templar-favourite-toggle${this.plugin.library.isFavourite(template.id) ? ' is-active' : ''}`, attr: { 'aria-label': `${this.plugin.library.isFavourite(template.id) ? 'Remove' : 'Add'} ${template.name} ${this.plugin.library.isFavourite(template.id) ? 'from' : 'to'} favorites`, 'aria-pressed': String(this.plugin.library.isFavourite(template.id)) }, text: '★' });
    favorite.addEventListener('click', () => void this.plugin.library.toggleFavourite(template.id).then(() => this.render()));
    card.createDiv({ cls: 'templar-style-name', text: template.name });
    card.createDiv({ cls: 'templar-folder-badge', text: template.metadata.folder });
    if (this.plugin.settings.libraryDensity === 'comfortable') card.createDiv({ cls: 'templar-style-description', text: template.metadata.description });
    const count = this.plugin.usageIndex.count(template.id);
    if (count > 0) {
      const updates = this.plugin.usageIndex.entriesForTemplate(template.id).filter((entry) => entry.style && synchronizationStatus(entry.style, template).updateAvailable).length;
      if (updates > 0) {
        const badge = card.createEl('button', { cls: 'templar-usage-badge', text: `${String(count)} notes · ${String(updates)} updates`, attr: { 'aria-label': `Review ${String(updates)} updates for ${template.name}` } });
        badge.addEventListener('click', () => this.plugin.showSynchronizationReview(template.id));
      } else {
        card.createDiv({ cls: 'templar-usage-badge', text: `${String(count)} ${count === 1 ? 'note' : 'notes'}` });
      }
    }
    const actions = card.createDiv({ cls: 'templar-card-actions' });
    const apply = actions.createEl('button', { cls: 'mod-cta', text: 'Apply', attr: { title: this.plugin.activeFile() ? 'Apply style' : 'Open a Markdown note to apply this style' } });
    apply.disabled = !this.plugin.activeFile();
    apply.addEventListener('click', () => void this.plugin.applyTemplate(template));
    const more = actions.createEl('button', { attr: { 'aria-label': `More actions for ${template.name}`, title: 'More actions' } });
    setIcon(more, 'more-horizontal');
    more.addEventListener('click', (event) => this.showTemplateMenu(event, template));
  }

  private showTemplateMenu(event: MouseEvent, template: TemplarTemplate): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('Preview on current note').setIcon('eye').setDisabled(!this.plugin.activeFile()).onClick(() => this.previewTemplate(template)));
    menu.addItem((item) => item.setTitle('Apply with page options…').setIcon('settings-2').setDisabled(!this.plugin.activeFile()).onClick(() => this.plugin.showApplyWithOptions(template)));
    menu.addItem((item) => item.setTitle('Create new note with this style').setIcon('file-plus').onClick(() => this.plugin.showCreateStyledNote(template)));
    menu.addItem((item) => item.setTitle(template.builtIn ? 'Customize template' : 'Edit template').setIcon('pencil').onClick(() => this.plugin.showTemplateCreator(template)));
    menu.addItem((item) => item.setTitle('Duplicate').setIcon('copy').onClick(() => void this.plugin.library.duplicate(template.id).then(() => this.render())));
    menu.addItem((item) => item.setTitle('Export').setIcon('upload').onClick(() => void this.plugin.exportTemplate(template)));
    if (!template.builtIn) {
      menu.addSeparator();
      menu.addItem((item) => item.setTitle('Delete from library').setIcon('trash').onClick(() => this.confirmDelete(template)));
    }
    menu.showAtMouseEvent(event);
  }

  private showCurrentNoteMenu(event: MouseEvent, file: TFile): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle('Edit raw style…').setIcon('code').onClick(() => this.plugin.showRawStyleEditor(file)));
    menu.addItem((item) => item.setTitle('Print / export styled note').setIcon('printer').onClick(() => void this.plugin.printStyledNote(file)));
    menu.addItem((item) => item.setTitle('Review template updates').setIcon('refresh-cw').onClick(() => this.plugin.showSynchronizationReview()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle('Remove style').setIcon('eraser').onClick(() => void this.plugin.removeStyle(file)));
    menu.showAtMouseEvent(event);
  }

  private templatesForTab(catalog: TemplarTemplate[]): TemplarTemplate[] {
    const byId = new Map(catalog.map((template) => [template.id, template]));
    if (this.activeTab === 'recent') return this.plugin.settings.recentTemplateIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    if (this.activeTab === 'favorites') return this.plugin.settings.favouriteTemplateIds.flatMap((id) => byId.has(id) ? [byId.get(id)!] : []);
    if (this.activeTab === 'built-in') return catalog.filter((template) => template.builtIn);
    return catalog.filter((template) => !template.builtIn);
  }

  private previewTemplate(template: TemplarTemplate): void {
    const leaf = this.plugin.activeMarkdownLeaf();
    const file = this.plugin.activeFile();
    if (!leaf || !file) return;
    this.selectedId = template.id;
    this.plugin.preview.preview(this.previewOwner, leaf, file, template);
    this.render();
    this.focusSelectedCardAfterRender();
  }

  private async applyPreview(): Promise<void> {
    const session = this.plugin.preview.current(this.previewOwner);
    if (!session) return;
    await this.plugin.preview.cancel(this.previewOwner);
    await this.plugin.applyTemplate(noteTemplateSnapshot(session.style), session.file, session.style.page);
  }

  private async cancelPreview(): Promise<void> {
    await this.plugin.preview.cancel(this.previewOwner);
    this.render();
    this.focusSelectedCardAfterRender();
  }

  private async setDensity(density: LibraryDensity): Promise<void> {
    this.plugin.settings.libraryDensity = density;
    await this.plugin.saveSettings();
    this.render();
  }

  private updateRovingFocus(): void {
    for (const card of this.cardEls) card.tabIndex = card.dataset.templateId === this.selectedId ? 0 : -1;
  }

  private moveFocus(delta: number): void {
    const current = Math.max(0, this.cardEls.findIndex((card) => card.dataset.templateId === this.selectedId));
    const next = Math.max(0, Math.min(this.cardEls.length - 1, current + delta));
    this.selectedId = this.cardEls[next]?.dataset.templateId ?? this.selectedId;
    this.updateRovingFocus();
    this.cardEls[next]?.focus();
  }

  private moveVertical(direction: -1 | 1): void {
    if (this.plugin.settings.libraryDensity === 'compact') return this.moveFocus(direction);
    const current = this.cardEls.find((card) => card.dataset.templateId === this.selectedId);
    if (!current) return;
    const rect = current.getBoundingClientRect();
    const candidates = this.cardEls.filter((card) => direction < 0 ? card.getBoundingClientRect().bottom <= rect.top + 1 : card.getBoundingClientRect().top >= rect.bottom - 1);
    candidates.sort((a, b) => {
      const ar = a.getBoundingClientRect(); const br = b.getBoundingClientRect();
      const ay = Math.abs((ar.top + ar.bottom) / 2 - (rect.top + rect.bottom) / 2);
      const by = Math.abs((br.top + br.bottom) / 2 - (rect.top + rect.bottom) / 2);
      const ax = Math.abs((ar.left + ar.right) / 2 - (rect.left + rect.right) / 2);
      const bx = Math.abs((br.left + br.right) / 2 - (rect.left + rect.right) / 2);
      return ay - by || ax - bx;
    });
    const target = candidates[0];
    if (target) { this.selectedId = target.dataset.templateId ?? null; this.updateRovingFocus(); target.focus(); }
  }

  private readonly handleKeydown = (event: KeyboardEvent): void => {
    const target = event.target as HTMLElement;
    const inInput = target.matches('input, textarea, select') || target.isContentEditable;
    if (event.key === '/' && !inInput) { event.preventDefault(); this.focusSearch(); return; }
    if (event.key === 'Escape') {
      if (this.plugin.preview.current(this.previewOwner)) { event.preventDefault(); void this.cancelPreview(); return; }
      if (this.searchQuery) { event.preventDefault(); this.searchQuery = ''; this.render(); return; }
      if (this.activeFolder) { event.preventDefault(); this.activeFolder = null; this.render(); return; }
      if (!inInput) { target.blur(); return; }
    }
    const card = target.closest<HTMLElement>('.templar-style-card');
    if (!card || target !== card) return;
    const template = this.visibleTemplates.find((candidate) => candidate.id === card.dataset.templateId);
    if (!template) return;
    if (event.key === 'ArrowLeft' && this.plugin.settings.libraryDensity !== 'compact') { event.preventDefault(); this.moveFocus(-1); }
    else if (event.key === 'ArrowRight' && this.plugin.settings.libraryDensity !== 'compact') { event.preventDefault(); this.moveFocus(1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); this.moveVertical(-1); }
    else if (event.key === 'ArrowDown') { event.preventDefault(); this.moveVertical(1); }
    else if (event.key === 'Home') { event.preventDefault(); this.selectedId = this.cardEls[0]?.dataset.templateId ?? null; this.updateRovingFocus(); this.cardEls[0]?.focus(); }
    else if (event.key === 'End') { event.preventDefault(); const last = this.cardEls[this.cardEls.length - 1]; this.selectedId = last?.dataset.templateId ?? null; this.updateRovingFocus(); last?.focus(); }
    else if (event.key === ' ') { event.preventDefault(); this.previewTemplate(template); }
    else if (event.key === 'Enter') { event.preventDefault(); void this.plugin.applyTemplate(template); }
    else if (event.key.toLocaleLowerCase() === 'f') { event.preventDefault(); void this.plugin.library.toggleFavourite(template.id).then(() => this.render()); }
  };

  private confirmDelete(template: TemplarTemplate): void {
    new ConfirmationModal(this.plugin, `Delete “${template.name}” from the library?`, 'Notes already using it remain fully styled.', async () => {
      await this.plugin.library.remove(template.id);
      this.render();
    }, 'Delete style').open();
  }

  private cancelSearchFrame(): void {
    if (this.searchFrame === null) return;
    this.contentEl.ownerDocument.defaultView?.cancelAnimationFrame(this.searchFrame);
    this.searchFrame = null;
  }

  private focusSelectedCardAfterRender(): void {
    this.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
      this.cardEls.find((card) => card.dataset.templateId === this.selectedId)?.focus();
    });
  }
}
