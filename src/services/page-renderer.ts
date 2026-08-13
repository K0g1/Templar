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
import { compilePageStyle } from './style-compiler';
import { ImageSnapController } from './rendering/image-snap-controller';
import { PaperOriginController } from './rendering/paper-origin-controller';
import { ReadingWhitespaceController } from './rendering/reading-whitespace-controller';
import { OwnedStyleHost } from './rendering/style-host';
import { VariableBlockRhythmController } from './rendering/variable-block-rhythm-controller';
import {
  DEFAULT_PERF_FEATURE_MASK,
  TEMPLAR_PERF_ENABLED,
  type PerfFeatureMask,
} from '../performance/performance-types';
import type { PerformanceMonitor } from '../performance/performance-monitor';

export type RefreshReason =
  | 'css-change'
  | 'active-leaf-change'
  | 'file-open'
  | 'layout-change'
  | 'metadata-change'
  | 'rename'
  | 'delete'
  | 'markdown-postprocessor'
  | 'font-loadingdone'
  | 'preview-start'
  | 'preview-cancel'
  | 'preview-retarget'
  | 'settings-refresh'
  | 'explicit-refresh'
  | 'unknown';

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
  private scheduledReason: RefreshReason = 'unknown';
  private readonly leafGenerations = new WeakMap<WorkspaceLeaf, number>();
  private readonly leafScopeIds = new WeakMap<WorkspaceLeaf, number>();
  private nextLeafScopeId = 1;
  private readonly styledViews = new Map<WorkspaceLeaf, StyledView>();
  private readonly issuesByLeaf = new Map<WorkspaceLeaf, LeafIssueState>();
  private readonly fontDocumentCleanups = new Map<Document, () => void>();
  private readonly pageLayout: PageLayoutService;
  private readonly styleHost = new OwnedStyleHost();
  private readonly previews = new Map<WorkspaceLeaf, PreviewState>();
  private readonly imageSnap: ImageSnapController;
  private readonly paperOrigin: PaperOriginController;
  private readonly rhythm: VariableBlockRhythmController;
  private readonly readingWhitespace: ReadingWhitespaceController;
  private readonly performanceMonitor?: PerformanceMonitor;
  private featureMask: PerfFeatureMask = { ...DEFAULT_PERF_FEATURE_MASK };
  private readonly styleFingerprints = new Map<string, string>();

  public constructor(
    private readonly app: App,
    private readonly settings: TemplarSettings,
    private readonly frontmatter: FrontmatterService,
    private readonly fontMetrics: FontMetricsService,
    performanceMonitor?: PerformanceMonitor,
  ) {
    this.performanceMonitor = performanceMonitor;
    this.readingWhitespace = new ReadingWhitespaceController(
      app,
      () => this.settings.enableReadingView,
      performanceMonitor,
    );
    this.pageLayout = new PageLayoutService(performanceMonitor);
    this.imageSnap = new ImageSnapController(performanceMonitor);
    this.paperOrigin = new PaperOriginController(performanceMonitor);
    this.rhythm = new VariableBlockRhythmController(performanceMonitor);
  }

  public scheduleRefreshAll(reason: RefreshReason = 'unknown'): void {
    this.performanceMonitor?.counter('renderer.scheduleRefreshAll.attempt', 1, { reason });
    if (this.destroyed || this.scheduled) {
      this.performanceMonitor?.counter('renderer.scheduleRefreshAll.deduped', 1, { reason });
      return;
    }
    this.performanceMonitor?.counter('renderer.scheduleRefreshAll.accepted', 1, { reason });
    this.scheduled = true;
    this.scheduledReason = reason;
    queueMicrotask(() => {
      this.scheduled = false;
      if (!this.destroyed) {
        const scheduledReason = this.scheduledReason;
        this.scheduledReason = 'unknown';
        this.refreshAll(scheduledReason).catch((error: unknown) => {
          console.error('[Templar] Scheduled renderer refresh failed', error);
        });
      }
    });
  }

  public async refreshAll(reason: RefreshReason = 'explicit-refresh'): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    this.performanceMonitor?.counter('renderer.refreshAll.count', 1, {
      reason,
      leafCount: leaves.length,
    });
    const activeLeaves = new Set(leaves);
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf, reason);
    }
    for (const leaf of this.styledViews.keys()) {
      if (!activeLeaves.has(leaf)) {
        this.clearLeaf(leaf);
      }
    }
  }

  public async refreshFile(file: TFile, reason: RefreshReason = 'explicit-refresh'): Promise<void> {
    if (this.destroyed) {
      return;
    }
    const leaves = this.app.workspace
      .getLeavesOfType('markdown')
      .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    this.performanceMonitor?.counter('renderer.refreshFile.count', 1, {
      reason,
      leafCount: leaves.length,
    });
    for (const leaf of leaves) {
      if (this.destroyed) {
        return;
      }
      await this.refreshLeaf(leaf, reason);
    }
  }

  public async refreshLeafNow(leaf: WorkspaceLeaf, reason: RefreshReason = 'explicit-refresh'): Promise<void> {
    await this.refreshLeaf(leaf, reason);
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
    await this.refreshLeaf(leaf, 'preview-start');
  }

  public async cancelPreview(leaf: WorkspaceLeaf, owner?: string): Promise<void> {
    const state = this.previews.get(leaf);
    if (!state || (owner && state.owner !== owner)) return;
    this.previews.delete(leaf);
    await this.refreshLeaf(leaf, 'preview-cancel');
  }

  public cancelPreviewsByOwner(owner: string): void {
    for (const [leaf, state] of this.previews) {
      if (state.owner !== owner) continue;
      this.previews.delete(leaf);
      this.refreshLeaf(leaf, 'preview-cancel').catch((error: unknown) => {
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

  public registerReadingSection(
    element: HTMLElement,
    context: MarkdownPostProcessorContext,
  ): void {
    this.readingWhitespace.registerSection(element, context);
  }

  public setFeatureMask(mask: Partial<PerfFeatureMask>, refresh = true): PerfFeatureMask {
    if (!TEMPLAR_PERF_ENABLED) return { ...this.featureMask };
    this.featureMask = { ...this.featureMask, ...mask };
    this.performanceMonitor?.setFeatureMask(this.featureMask);
    if (refresh) this.scheduleRefreshAll('explicit-refresh');
    return { ...this.featureMask };
  }

  public getFeatureMask(): PerfFeatureMask {
    return { ...this.featureMask };
  }

  public lastKnownStyleFingerprint(path: string): string | null {
    return this.styleFingerprints.get(path) ?? null;
  }

  public forgetStyleFingerprint(path: string): void {
    this.styleFingerprints.delete(path);
  }

  public stateSnapshot(): Record<string, number> {
    const pageLayout = this.pageLayout.snapshot();
    const imageSnap = this.imageSnap.snapshot();
    const paperOrigin = this.paperOrigin.snapshot();
    const rhythm = this.rhythm.snapshot();
    const reading = this.readingWhitespace.snapshot();
    return {
      'PageRenderer.styledViews': this.styledViews.size,
      'PageRenderer.previews': this.previews.size,
      'PageRenderer.issuesByLeaf': this.issuesByLeaf.size,
      'PageRenderer.fontDocumentCleanups': this.fontDocumentCleanups.size,
      'PageLayout.states': pageLayout.states ?? 0,
      'PageLayout.scopes': pageLayout.scopes ?? 0,
      'PageLayout.observedTargets': pageLayout.observedTargets ?? 0,
      'ImageSnap.states': imageSnap.states ?? 0,
      'ImageSnap.observedImages': imageSnap.observedImages ?? 0,
      'PaperOrigin.states': paperOrigin.states ?? 0,
      'PaperOrigin.observedElements': paperOrigin.observedElements ?? 0,
      'PaperOrigin.pageContents': paperOrigin.pageContents ?? 0,
      'VariableRhythm.states': rhythm.states ?? 0,
      'VariableRhythm.observedBlocks': rhythm.observedBlocks ?? 0,
      'VariableRhythm.pendingMeasurements': rhythm.pendingMeasurements ?? 0,
      'Reading.roots': reading.roots ?? 0,
      'Reading.scheduledRoots': reading.scheduledRoots ?? 0,
      'FontMetrics.cacheSize': this.fontMetrics.size,
      'Templar.scheduledRefresh': this.scheduled ? 1 : 0,
    };
  }

  public destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.readingWhitespace.destroy();
    this.imageSnap.destroy();
    this.paperOrigin.destroy();
    this.rhythm.destroy();
    this.pageLayout.destroy();
    this.previews.clear();
    for (const leaf of [...this.styledViews.keys()]) {
      this.clearLeaf(leaf);
    }
    for (const cleanup of this.fontDocumentCleanups.values()) cleanup();
    this.fontDocumentCleanups.clear();
    this.fontMetrics.clear();
    this.issuesByLeaf.clear();
    this.styleFingerprints.clear();
  }

  private async refreshLeaf(leaf: WorkspaceLeaf, reason: RefreshReason): Promise<void> {
    const refresh = async (): Promise<void> => this.refreshLeafInternal(leaf, reason);
    if (this.performanceMonitor) {
      await this.performanceMonitor.measureAsync('renderer.refreshLeaf.total', refresh, { reason });
    } else {
      await refresh();
    }
  }

  private async refreshLeafInternal(leaf: WorkspaceLeaf, reason: RefreshReason): Promise<void> {
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
    const style = this.performanceMonitor
      ? this.performanceMonitor.measureSync(
        'renderer.refreshLeaf.resolveStyle',
        () => file ? this.previews.get(leaf)?.style ?? this.frontmatter.getStyle(file) : null,
      )
      : file ? this.previews.get(leaf)?.style ?? this.frontmatter.getStyle(file) : null;
    if (!file || !style) {
      this.clearLeaf(leaf);
      return;
    }

    if (typeof this.frontmatter.inspect === 'function') {
      this.styleFingerprints.set(file.path, this.frontmatter.inspect(file).fingerprint);
    }
    this.performanceMonitor?.counter('renderer.refreshLeaf.count', 1, {
      reason,
      leafCount: this.app.workspace.getLeavesOfType('markdown').length,
      mode: style.page.mode,
      readingEnabled: this.settings.enableReadingView,
      livePreviewEnabled: this.settings.enableLivePreview,
      previewActive: this.previews.has(leaf),
    });

    const run = (this.leafGenerations.get(leaf) ?? 0) + 1;
    this.leafGenerations.set(leaf, run);
    const document = view.contentEl.ownerDocument;
    this.observeFontDocument(document);
    const metrics = this.performanceMonitor
      ? await this.performanceMonitor.measureAsync('renderer.refreshLeaf.fontMetrics', () => this.fontMetrics.measurePage(style, document))
      : await this.fontMetrics.measurePage(style, document);
    if (
      this.destroyed ||
      this.leafGenerations.get(leaf) !== run ||
      view.file?.path !== file.path
    ) {
      return;
    }

    if (this.performanceMonitor) {
      this.performanceMonitor.measureSync('renderer.refreshLeaf.prepareRoots', () => this.prepareViewRoots(view.contentEl));
    } else {
      this.prepareViewRoots(view.contentEl);
    }
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
    const compiled = this.performanceMonitor?.measureSync(
      'renderer.refreshLeaf.compileStyle',
      () => compilePageStyle(style, scope, scopeValue, metrics),
    ) ?? compilePageStyle(style, scope, scopeValue, metrics);
    this.issuesByLeaf.set(leaf, { filePath: file.path, issues: clone(compiled.issues) });
    if (compiled.issues.some((issue) => issue.path === 'css.generated')) {
      this.clearLeaf(leaf, true);
      return;
    }

    const styleEl = this.styleHost.ensure(view.contentEl);
    this.performanceMonitor?.counter('renderer.refreshLeaf.styleHostWrite');
    styleEl.textContent = compiled.css;
    this.styledViews.set(leaf, { contentEl: view.contentEl, filePath: file.path });
    if (this.featureMask.paperOrigin) {
      this.paperOrigin.configure(leaf, view.contentEl, style, metrics);
    } else {
      this.paperOrigin.clear(leaf);
    }
    if (this.featureMask.imageSnap) {
      this.imageSnap.configure(leaf, view.contentEl, style);
    } else {
      this.imageSnap.clear(leaf);
    }
    if (this.featureMask.variableRhythm) {
      this.rhythm.configure(leaf, view.contentEl, style);
    } else {
      this.rhythm.clear(leaf);
    }
    if (this.featureMask.pageLayout) {
      this.pageLayout.configure(leaf, view.contentEl, style);
    } else {
      this.pageLayout.clear(leaf);
    }
    const readingRoot = view.contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    if (this.featureMask.readingWhitespace && this.settings.enableReadingView && readingRoot) {
      this.performanceMonitor?.counter('renderer.refreshLeaf.readingPrepare');
      this.readingWhitespace.prepareCachedSections(readingRoot, file);
      this.performanceMonitor?.counter('renderer.refreshLeaf.readingActivate');
      this.readingWhitespace.activateRoot(readingRoot, file);
    } else if (readingRoot) {
      if (this.featureMask.readingWhitespace) this.readingWhitespace.deactivateRoot(readingRoot);
      else this.readingWhitespace.clearRoot(readingRoot);
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
      this.scheduleRefreshAll('font-loadingdone');
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
    this.paperOrigin.clear(leaf);
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
    this.imageSnap.clear(leaf);
    this.rhythm.clear(leaf);
    this.readingWhitespace.pruneDisconnected();
    if (!preserveIssue) this.issuesByLeaf.delete(leaf);
    this.styledViews.delete(leaf);
  }

}
