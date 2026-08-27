import {
  MarkdownView,
  TFile,
  type App,
  type MarkdownPostProcessorContext,
  type WorkspaceLeaf,
} from 'obsidian';
import {
  TEMPLAR_CLASS,
  TEMPLAR_CONTENT_CLASS,
  TEMPLAR_PAGE_CLASS,
} from '../constants';
import type { TemplarNoteStyle, TemplarSettings, ValidationIssue } from '../types';
import { escapeCssAttribute } from '../utils/value';
import { leafScopeValue } from '../utils/scope';
import { clone } from '../utils/value';
import { FontMetricsService } from './font-metrics';
import type { FrontmatterService } from './frontmatter';
import { PageLayoutService } from './page-layout';
import { compilePageStyle, type PageMetricSet } from './style-compiler';
import { BaselineGridController } from './rendering/baseline-grid/controller';
import { ReadingWhitespaceController } from './rendering/reading-whitespace-controller';
import { OwnedStyleHost } from './rendering/style-host';
import {
  diagnoseBaselineAlignment,
  serializeBaselineDiagnostic,
  type BaselineDiagnosticReport,
} from './baseline-diagnostic';
import { writeTextToClipboard } from '../utils/clipboard';

interface StyledView {
  contentEl: HTMLElement;
  filePath: string;
}

interface LeafIssueState {
  filePath: string;
  issues: ValidationIssue[];
}

interface PreviewState {
  owner: string;
  filePath: string;
  style: TemplarNoteStyle;
}

export class PageRenderer {
  private destroyed = false;
  private scheduled = false;
  private readonly leafGenerations = new WeakMap<WorkspaceLeaf, number>();
  private readonly leafScopeIds = new WeakMap<WorkspaceLeaf, number>();
  private readonly metricsByLeaf = new WeakMap<WorkspaceLeaf, PageMetricSet>();
  private nextLeafScopeId = 1;
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly issuesByLeaf = new Map<WorkspaceLeaf, LeafIssueState>();
  private readonly fontDocumentCleanups = new Map<Document, () => void>();
  private readonly pageLayout = new PageLayoutService();
  private readonly styleHost = new OwnedStyleHost();
  private readonly previews = new Map<WorkspaceLeaf, PreviewState>();
  private readonly baselineGrid = new BaselineGridController();
  private readonly readingWhitespace: ReadingWhitespaceController;

  public constructor(
    private readonly app: App,
    private readonly settings: TemplarSettings,
    private readonly frontmatter: FrontmatterService,
    private readonly fontMetrics: FontMetricsService,
  ) {
    this.readingWhitespace = new ReadingWhitespaceController(
      app,
      () => this.settings.enableReadingView,
    );
  }

  public scheduleRefreshAll(): void {
    if (this.destroyed || this.scheduled) {
      return;
    }
    this.scheduled = true;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) {
        this.refreshAll().catch((error: unknown) => {
          console.error('[Templar] Scheduled renderer refresh failed', error);
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
    const unique = new Map<string, ValidationIssue>();
    for (const state of this.issuesByLeaf.values()) {
      if (state.filePath !== file.path) continue;
      for (const issue of state.issues) {
        const key = `${issue.severity}|${issue.path}|${issue.message}|${issue.fix ?? ''}`;
        unique.set(key, clone(issue));
      }
    }
    return [...unique.values()].sort((left, right) => {
      const severity = (issue: ValidationIssue): number => issue.severity === 'error' ? 0 : 1;
      return severity(left) - severity(right) || left.path.localeCompare(right.path) || left.message.localeCompare(right.message);
    });
  }

  public async setPreview(
    leaf: WorkspaceLeaf,
    owner: string,
    filePath: string,
    style: TemplarNoteStyle,
  ): Promise<void> {
    this.previews.set(leaf, { owner, filePath, style: clone(style) });
    await this.refreshLeaf(leaf);
  }

  public async cancelPreview(leaf: WorkspaceLeaf, owner?: string): Promise<void> {
    const state = this.previews.get(leaf);
    if (!state || (owner && state.owner !== owner)) return;
    this.previews.delete(leaf);
    await this.refreshLeaf(leaf);
  }

  public cancelPreviewsByOwner(owner: string): void {
    for (const [leaf, state] of this.previews) {
      if (state.owner !== owner) continue;
      this.previews.delete(leaf);
      this.refreshLeaf(leaf).catch((error: unknown) => {
        console.error('[Templar] Preview cleanup refresh failed', error);
      });
    }
  }

  public previewStyle(leaf: WorkspaceLeaf): TemplarNoteStyle | null {
    return this.previews.has(leaf) ? clone(this.previews.get(leaf)!.style) : null;
  }

  public resolvedStyle(leaf: WorkspaceLeaf): TemplarNoteStyle | null {
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      return null;
    }
    return clone(
      this.previews.get(leaf)?.style ??
      this.frontmatter.getStyle(leaf.view.file),
    );
  }

  public baselineDiagnostic(leaf: WorkspaceLeaf): BaselineDiagnosticReport | null {
    const styled = this.styledViews.get(leaf);
    const metrics = this.metricsByLeaf.get(leaf);
    this.baselineGrid.refresh(leaf);
    return styled && metrics
      ? diagnoseBaselineAlignment(styled.contentEl, metrics, {
        roots: this.baselineGrid.diagnosticRoots(leaf),
        stats: this.baselineGrid.stats(leaf),
      })
      : null;
  }

  /**
   * Wait for Obsidian's virtualized Reading View/widgets to finish a layout
   * turn before exposing a diagnostic. A synchronous refresh remains useful
   * to callers, but a command run immediately after scrolling can otherwise
   * report the intermediate DOM that Obsidian is still replacing.
   */
  public async settledBaselineDiagnostic(leaf: WorkspaceLeaf): Promise<BaselineDiagnosticReport | null> {
    let report: BaselineDiagnosticReport | null = null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.waitForBaselineFrames(leaf, 2);
      report = this.baselineDiagnostic(leaf);
      if (!report || report.nonConvergedElements.length > 0) continue;
      await this.waitForBaselineFrames(leaf, 2);
      const stable = this.baselineDiagnostic(leaf);
      if (!stable || stable.nonConvergedElements.length === 0) return stable;
      report = stable;
    }
    return report;
  }

  public toggleBaselineDebugOverlay(leaf: WorkspaceLeaf): boolean {
    return this.baselineGrid.toggleDebugOverlay(leaf);
  }

  public async copyBaselineDiagnostic(leaf: WorkspaceLeaf): Promise<BaselineDiagnosticReport | null> {
    const report = await this.settledBaselineDiagnostic(leaf);
    if (!report) return null;
    const document = this.styledViews.get(leaf)?.contentEl.ownerDocument;
    if (!document) throw new Error('The current styled note no longer has an owner document.');
    await writeTextToClipboard(serializeBaselineDiagnostic(report), document);
    return report;
  }

  public registerReadingSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    this.readingWhitespace.registerSection(element, context);
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.readingWhitespace.destroy();
    this.baselineGrid.destroy();
    this.pageLayout.destroy();
    this.previews.clear();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
    for (const cleanup of this.fontDocumentCleanups.values()) cleanup();
    this.fontDocumentCleanups.clear();
    this.fontMetrics.clear();
    this.issuesByLeaf.clear();
  }

  private async refreshLeaf(leaf: WorkspaceLeaf): Promise<void> {
    if (this.destroyed) {
      return;
    }
    this.readingWhitespace.pruneDisconnected();
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
    this.observeFontDocument(document);
    const metrics = await this.fontMetrics.measurePage(style, document);
    if (
      this.destroyed ||
      this.leafGenerations.get(leaf) !== run ||
      view.file?.path !== file.path
    ) {
      return;
    }
    this.metricsByLeaf.set(leaf, metrics);

    this.prepareViewRoots(view.contentEl);
    let leafScopeId = this.leafScopeIds.get(leaf);
    if (leafScopeId === undefined) {
      leafScopeId = this.nextLeafScopeId;
      this.nextLeafScopeId += 1;
      this.leafScopeIds.set(leaf, leafScopeId);
    }
    const scopeValue = leafScopeValue(leafScopeId);
    view.contentEl.addClass(TEMPLAR_CLASS);
    view.contentEl.dataset.templarScope = scopeValue;
    view.contentEl.dataset.templarFile = file.path;
    const scope = `[data-templar-scope="${escapeCssAttribute(scopeValue)}"]`;
    const compiled = compilePageStyle(style, scope, scopeValue, metrics);
    this.issuesByLeaf.set(leaf, { filePath: file.path, issues: clone(compiled.issues) });
    if (compiled.issues.some((issue) => issue.path === 'css.generated')) {
      this.clearLeaf(leaf, true);
      return;
    }

    const styleEl = this.styleHost.ensure(view.contentEl);
    styleEl.textContent = compiled.css;
    this.styledViews.set(leaf, { contentEl: view.contentEl, filePath: file.path });
    this.pageLayout.configure(leaf, view.contentEl, style);
    const readingRoot = view.contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    if (this.settings.enableReadingView && readingRoot) {
      this.readingWhitespace.prepareCachedSections(readingRoot, file);
      this.readingWhitespace.activateRoot(readingRoot, file);
    } else if (readingRoot) {
      this.readingWhitespace.deactivateRoot(readingRoot);
    }
    this.baselineGrid.configure(leaf, { contentEl: view.contentEl, style, metrics });
    // Paged layout applies scale on its next animation frame. Re-measure the
    // absolute grid after that scale exists so corrections use CSS pixels.
    view.contentEl.ownerDocument.defaultView?.requestAnimationFrame(() => {
      if (this.styledViews.get(leaf)?.contentEl === view.contentEl) {
        this.baselineGrid.refresh(leaf);
      }
    });
  }

  private async waitForBaselineFrames(leaf: WorkspaceLeaf, count: number): Promise<void> {
    const document = this.styledViews.get(leaf)?.contentEl.ownerDocument;
    const view = document?.defaultView;
    if (!view) return;
    for (let index = 0; index < count; index += 1) {
      await new Promise<void>((resolve) => {
        if (view.requestAnimationFrame) {
          view.requestAnimationFrame(() => resolve());
        } else {
          view.setTimeout(resolve, 0);
        }
      });
    }
  }

  private prepareViewRoots(contentEl: HTMLElement): void {
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_PAGE_CLASS}`)) {
      element.removeClass(TEMPLAR_PAGE_CLASS);
    }
    for (const element of contentEl.querySelectorAll(`.${TEMPLAR_CONTENT_CLASS}`)) {
      element.removeClass(TEMPLAR_CONTENT_CLASS);
    }

    const readingRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    const sourceRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-source-view.mod-cm6',
    );
    if (this.settings.enableReadingView && readingRoot) {
      readingRoot.addClass(TEMPLAR_PAGE_CLASS);
      readingRoot
        .querySelector(':scope > .markdown-preview-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    } else if (readingRoot) {
      this.readingWhitespace.deactivateRoot(readingRoot);
    }
    if (this.settings.enableLivePreview && sourceRoot) {
      const scroller = sourceRoot.querySelector<HTMLElement>(
        ':scope > .cm-editor > .cm-scroller',
      );
      scroller?.addClass(TEMPLAR_PAGE_CLASS);
      scroller
        ?.querySelector(':scope > .cm-sizer')
        ?.addClass(TEMPLAR_CONTENT_CLASS);
    }
  }

  private observeFontDocument(document: Document): void {
    for (const [known, cleanup] of this.fontDocumentCleanups) {
      if (known.defaultView?.closed) {
        cleanup();
        this.fontDocumentCleanups.delete(known);
      }
    }
    if (this.fontDocumentCleanups.has(document) || !document.fonts) {
      return;
    }
    const loaded = (): void => {
      this.fontMetrics.clear();
      this.scheduleRefreshAll();
    };
    document.fonts.addEventListener('loadingdone', loaded);
    this.fontDocumentCleanups.set(document, () =>
      document.fonts.removeEventListener('loadingdone', loaded),
    );
  }

  private clearLeaf(leaf: WorkspaceLeaf, preserveIssue = false): void {
    this.leafGenerations.set(leaf, (this.leafGenerations.get(leaf) ?? 0) + 1);
    this.pageLayout.clear(leaf);
    if (!(leaf.view instanceof MarkdownView) || !leaf.view.file) {
      this.previews.delete(leaf);
    }
    const styled = this.styledViews.get(leaf);
    const contentEl =
      styled?.contentEl ??
      (leaf.view instanceof MarkdownView ? leaf.view.contentEl : undefined);
    this.baselineGrid.clear(leaf);
    if (contentEl) {
      contentEl.removeClass(TEMPLAR_CLASS);
      delete contentEl.dataset.templarScope;
      delete contentEl.dataset.templarFile;
      delete contentEl.dataset.templarMode;
      this.styleHost.clear(contentEl);
      for (const element of contentEl.querySelectorAll(`.${TEMPLAR_PAGE_CLASS}`)) {
        element.removeClass(TEMPLAR_PAGE_CLASS);
      }
      for (const element of contentEl.querySelectorAll(`.${TEMPLAR_CONTENT_CLASS}`)) {
        element.removeClass(TEMPLAR_CONTENT_CLASS);
      }
      const readingRoot = contentEl.querySelector<HTMLElement>(
        ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
      );
      if (readingRoot) this.readingWhitespace.clearRoot(readingRoot);
    }
    this.readingWhitespace.pruneDisconnected();
    if (!preserveIssue) this.issuesByLeaf.delete(leaf);
    this.styledViews.delete(leaf);
    this.metricsByLeaf.delete(leaf);
  }

}
