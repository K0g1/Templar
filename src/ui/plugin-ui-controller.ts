import { Notice, type WorkspaceLeaf } from 'obsidian';
import type TemplarPlugin from '../main';
import { TEMPLAR_VIEW_TYPE } from '../constants';
import type { TemplarTemplate } from '../types';
import {
  ApplyStyleModal,
  BatchApplyModal,
  CreateStyledNoteModal,
  CurrentNoteInspectorModal,
  PageModeModal,
  RawStyleModal,
  StylePickerModal,
  StyleRulesModal,
  SynchronizationReviewModal,
  TemplateCreatorModal,
  TemplateImportModal,
  TemplatePackExportModal,
} from './modals';
import { TemplarStylesView } from './styles-view';

/** Owns modal, view, and picker construction at the plugin/UI boundary. */
export class PluginUiController {
  public constructor(private readonly plugin: TemplarPlugin) {}

  public showStylePicker(file = this.plugin.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before choosing a page style.');
      return;
    }
    new StylePickerModal(this.plugin, file, 'apply').open();
  }

  public showApplyTemplate(template: TemplarTemplate, file = this.plugin.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    void this.plugin.applyTemplate(template, file);
  }

  public showApplyWithOptions(template: TemplarTemplate, file = this.plugin.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before applying a page style.');
      return;
    }
    new ApplyStyleModal(this.plugin, file, template).open();
  }

  public showNewNoteStylePicker(): void {
    new StylePickerModal(this.plugin, null, 'create').open();
  }

  public showCreateStyledNote(template: TemplarTemplate): void {
    new CreateStyledNoteModal(this.plugin, template).open();
  }

  public showPageMode(file = this.plugin.activeFile()): void {
    const style = file ? this.plugin.frontmatter.getStyle(file) : null;
    if (!file || !style) {
      new Notice('Apply a page style before changing page mode.');
      return;
    }
    new PageModeModal(this.plugin, file, style).open();
  }

  public showTemplateCreator(template?: TemplarTemplate): void {
    new TemplateCreatorModal(this.plugin, template).open();
  }

  public showTemplateImporter(): void {
    new TemplateImportModal(this.plugin).open();
  }

  public showPackExporter(templates?: TemplarTemplate[]): void {
    new TemplatePackExportModal(this.plugin, templates).open();
  }

  public showSynchronizationReview(templateId?: string): void {
    new SynchronizationReviewModal(this.plugin, templateId).open();
  }

  public showStyleRules(): void {
    new StyleRulesModal(this.plugin).open();
  }

  public showRawStyleEditor(file = this.plugin.activeFile()): void {
    if (!file) {
      new Notice('Open a Markdown note before editing its raw style.');
      return;
    }
    const style = this.plugin.frontmatter.getStyle(file);
    if (!style) {
      new Notice('Apply a page style to this note first.');
      return;
    }
    void this.plugin.preview.cancelAll().then(() => new RawStyleModal(this.plugin, file, style).open());
  }

  public showCurrentNoteInspector(file = this.plugin.activeFile()): void {
    const style = file ? this.plugin.frontmatter.getStyle(file) : null;
    if (!file || !style) return;
    new CurrentNoteInspectorModal(this.plugin, file, style).open();
  }

  public showBatchApply(): void {
    new BatchApplyModal(this.plugin).open();
  }

  public async openStylesView(): Promise<void> {
    let leaf: WorkspaceLeaf | null = this.plugin.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0] ?? null;
    if (!leaf) {
      leaf = this.plugin.app.workspace.getRightLeaf(false);
      if (!leaf) return;
      await leaf.setViewState({ type: TEMPLAR_VIEW_TYPE, active: true });
    }
    await this.plugin.app.workspace.revealLeaf(leaf);
  }

  public async focusStyleSearch(): Promise<void> {
    await this.openStylesView();
    const leaf = this.plugin.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0];
    if (leaf?.view instanceof TemplarStylesView) leaf.view.focusSearch();
  }

  public async cycleFavouritePreview(direction: 1 | -1): Promise<void> {
    await this.openStylesView();
    const leaf = this.plugin.app.workspace.getLeavesOfType(TEMPLAR_VIEW_TYPE)[0];
    if (leaf?.view instanceof TemplarStylesView) leaf.view.previewNextFavourite(direction);
  }
}
