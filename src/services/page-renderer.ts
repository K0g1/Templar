import {
  MarkdownView,
  TFile,
  type App,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from 'obsidian';
import { TEMPLAR_STYLE_ELEMENT_CLASS } from '../constants';
import type { TemplarNoteStyle, TemplarSettings, ValidationIssue } from '../types';
import { escapeCssAttribute } from '../utils/value';
import { FontMetricsService } from './font-metrics';
import type { FrontmatterService } from './frontmatter';
import { PageLayoutService } from './page-layout';
import { compilePageStyle } from './style-compiler';
import { ImageSnapController } from './image-snap-controller';
import { ReadingViewWhitespaceController } from './reading-whitespace-controller';
import { PreviewStyleStore } from './preview-style-store';
import { ViewStyleHost } from './view-style-host';

interface StyledView {
  contentEl: HTMLElement;
  filePath: string;
}

/**
 * Coordinates per-leaf rendering for Templar.
 *
 * PageRenderer is intentionally an orchestration facade: style compilation,
 * DOM artifact ownership, image snapping, reading whitespace, and preview
 * state each live in a dedicated controller. The renderer decides *when*
 * work happens; the controllers decide *how*.
 */
export class PageRenderer {
  private destroyed = false;
  private scheduled = false;
  private readonly leafGenerations = new WeakMap<WorkspaceLeaf, number>();
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly leafScopeIds = new WeakMap<WorkspaceLeaf, string>();
  private readonly issuesByLeaf = new Map<WorkspaceLeaf, { filePath: string; issues: ValidationIssue[] }>();
  private readonly pageLayout = new PageLayoutService();
  private readonly previews = new PreviewStyleStore();
  private readonly imageSnap = new ImageSnapController();
  private readonly whitespace: ReadingViewWhitespaceController;
  private readonly styleHost: ViewStyleHost;
  private scopeCounter = 0;

  public constructor(
    private readonly app: App,
    private readonly settings: TemplarSettings,
    private readonly frontmatter: FrontmatterService,
    private readonly fontMetrics: FontMetricsService,
  ) {
    this.whitespace = new ReadingViewWhitespaceController(app);
    this.styleHost = new ViewStyleHost(settings);
  }

  public scheduleRefreshAll(): void {
    if (this.destroyed || this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) {
        void this.refreshAll().catch((error) => {
          console.error('[Templar] refreshAll failed:', error);
        });
      }
    });
  }

  public async refreshAll(): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const activeLeaves = new Set(leaves);
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf);
    }
    for (const leaf of this.styledViews.keys()) {
      if (!activeLeaves.has(leaf)) {
        this.clearLeaf(leaf);
      }
    }
  }

  public async refreshFile(file: TFile): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace
      .getLeavesOfType('markdown')
      .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf);
    }
  }

  public async refreshLeafNow(leaf: WorkspaceLeaf): Promise<void> {
    await this.refreshLeaf(leaf);
  }

  public preparePrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    this.pageLayout.preparePrint(leaf, style);
  }

  public restoreAfterPrint(leaf: WorkspaceLeaf, style: TemplarNoteStyle): void {
    this.pageLayout.restoreAfterPrint(leaf, style);
  }

  public issuesFor(file: TFile): ValidationIssue[] {
    // Aggregate per-leaf issues for the file; a diagnostics panel wants all
    // open views' issues, while lifecycle cleanup stays leaf-scoped.
    const all: ValidationIssue[] = [];
    for (const entry of this.issuesByLeaf.values()) {
      if (entry.filePath === file.path) {
        all.push(...entry.issues);
      }
    }
    return all;
  }

  public async setPreview(
    leaf: WorkspaceLeaf,
    owner: string,
    filePath: string,
    style: TemplarNoteStyle,
  ): Promise<void> {
    this.previews.set(leaf, { owner, filePath, style });
    await this.refreshLeaf(leaf);
  }

  public async cancelPreview(leaf: WorkspaceLeaf, owner?: string): Promise<void> {
    const state = this.previews.get(leaf);
    if (!state || (owner && state.owner !== owner)) return;
    this.previews.delete(leaf);
    await this.refreshLeaf(leaf);
  }

  public cancelPreviewsByOwner(owner: string): void {
    for (const leaf of this.previews.deleteByOwner(owner)) {
      void this.refreshLeaf(leaf).catch((error) => {
        console.error('[Templar] refreshLeaf failed:', error);
      });
    }
  }

  public previewStyle(leaf: WorkspaceLeaf): TemplarNoteStyle | null {
    return this.previews.get(leaf)?.style ?? null;
  }

  public registerReadingSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    if (this.destroyed || !this.settings.enableReadingView) {
      return;
    }
    this.whitespace.registerReadingSection(element, context);
    const file = this.app.vault.getAbstractFileByPath(context.sourcePath);
    const readingRoot = element.closest<HTMLElement>('.markdown-preview-view');
    if (
      file instanceof TFile &&
      readingRoot &&
      this.frontmatter.hasStyle(file)
    ) {
      // Reconcile synchronously inside the post-processor. Obsidian renders
      // this section and measures its height later in the same task, so the
      // spacers must already be in place: any deferred insertion lands after
      // the first paint (the visible flash) and after the height measurement
      // (which makes the virtual scroller drift from the real layout).
      this.whitespace.reconcileSection(readingRoot, element);
    }
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.whitespace.destroy();
    this.pageLayout.destroy();
    this.previews.clear();
    this.imageSnap.disconnectAll();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
    this.fontMetrics.clear();
    this.issuesByLeaf.clear();
  }

  private async refreshLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.whitespace.pruneDisconnectedRoots();
    if (!(leaf.view instanceof MarkdownView)) {
      this.clearLeaf(leaf);
      return;
    }
    const view = leaf.view;
    const file = view.file;
    const preview = this.previews.get(leaf);
    if (preview && preview.filePath !== file?.path) {
      this.previews.delete(leaf);
    }
    const style = file
      ? this.previews.get(leaf)?.style ?? this.frontmatter.getStyle(file)
      : null;
    if (!file || !style) {
      this.clearLeaf(leaf);
      return;
    }

    const run = (this.leafGenerations.get(leaf) ?? 0) + 1;
    this.leafGenerations.set(leaf, run);

    const document = view.contentEl.ownerDocument;
    const metrics = await this.fontMetrics.measurePage(style, document);
    if (
      this.destroyed ||
      this.leafGenerations.get(leaf) !== run ||
      view.file?.path !== file.path
    ) {
      return;
    }

    this.styleHost.prepareViewRoots(view.contentEl);
    // If the leaf's content element changed since the last render (Obsidian
    // can replace the view root on mode switches), release the previous
    // root's DOM artifacts and observers before styling the new one.
    const previous = this.styledViews.get(leaf);
    if (previous && previous.contentEl !== view.contentEl) {
      this.styleHost.clearView(previous.contentEl);
      this.imageSnap.disconnect(previous.contentEl);
      this.whitespace.release(previous.contentEl);
    }
    const scopeId = this.scopeIdFor(leaf);
    const scopeValue = `templar-${scopeId}`;
    this.styleHost.applyScopedStyle(view.contentEl, '', scopeValue, file.path);
    const scope = `[data-templar-scope="${escapeCssAttribute(scopeValue)}"]`;
    const compiled = compilePageStyle(style, scope, scopeId, metrics);
    this.issuesByLeaf.set(leaf, { filePath: file.path, issues: compiled.issues });

    const styleEl = view.contentEl.querySelector<HTMLStyleElement>(
      `:scope > style.${TEMPLAR_STYLE_ELEMENT_CLASS}`,
    );
    if (styleEl) {
      styleEl.textContent = compiled.css;
    }
    this.styledViews.set(leaf, { contentEl: view.contentEl, filePath: file.path });
    this.imageSnap.configure(view.contentEl, style);
    this.pageLayout.configure(leaf, view.contentEl, style);
    const readingRoot = view.contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    if (this.settings.enableReadingView && readingRoot) {
      this.whitespace.registerCachedSections(readingRoot, file);
      this.whitespace.schedule(readingRoot);
    }
  }

  private clearLeaf(leaf: WorkspaceLeaf): void {
    this.leafGenerations.set(leaf, (this.leafGenerations.get(leaf) ?? 0) + 1);
    this.pageLayout.clear(leaf);
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.previews.delete(leaf);
    }
    const styled = this.styledViews.get(leaf);
    const contentEl =
      styled?.contentEl ??
      (leaf.view instanceof MarkdownView ? leaf.view.contentEl : undefined);
    if (contentEl) {
      this.styleHost.clearView(contentEl);
      this.imageSnap.disconnect(contentEl);
      this.whitespace.release(contentEl);
    }
    this.whitespace.pruneDisconnectedRoots();
    this.issuesByLeaf.delete(leaf);
    this.styledViews.delete(leaf);
  }

  /**
   * Returns a stable, collision-resistant scope ID that is unique per leaf
   * (not per file path). Two leaves showing the same note must never share a
   * CSS scope, otherwise a preview in one leaf would style the other.
   */
  private scopeIdFor(leaf: WorkspaceLeaf): string {
    let scopeId = this.leafScopeIds.get(leaf);
    if (!scopeId) {
      this.scopeCounter += 1;
      scopeId = `leaf${String(this.scopeCounter)}-${Math.random().toString(36).slice(2, 8)}`;
      this.leafScopeIds.set(leaf, scopeId);
    }
    return scopeId;
  }
}
