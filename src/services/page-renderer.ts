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
import { noteStyleFingerprint, stableFingerprint } from './style-fingerprint';
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
  styleFingerprint: string;
  cssFingerprint: string;
  readingRoot: HTMLElement | null;
  sourceRoot: HTMLElement | null;
  controllerKeys: {
    pageLayout: string;
    rhythm: string;
    imageSnap: string;
    paperOrigin: string;
  };
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
  private pendingGlobalRefresh = false;
  private readonly pendingLeaves = new Set<WorkspaceLeaf>();
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
    if (this.destroyed) {
      this.performanceMonitor?.counter('renderer.scheduleRefreshAll.deduped', 1, { reason });
      return;
    }
    this.pendingGlobalRefresh = true;
    this.performanceMonitor?.counter('renderer.scheduleRefreshAll.accepted', 1, { reason });
    this.queueScheduledRefresh(reason);
  }

  public scheduleRefreshLeaf(leaf: WorkspaceLeaf, reason: RefreshReason = 'unknown'): void {
    if (this.destroyed) return;
    this.pendingLeaves.add(leaf);
    this.performanceMonitor?.counter('renderer.scheduleRefreshLeaf.accepted', 1, { reason });
    this.queueScheduledRefresh(reason);
  }

  private queueScheduledRefresh(reason: RefreshReason): void {
    if (this.scheduled) {
      this.performanceMonitor?.counter('renderer.scheduleRefresh.deduped', 1, { reason });
      return;
    }
    this.scheduled = true;
    this.scheduledReason = reason;
    queueMicrotask(() => {
      this.scheduled = false;
      if (this.destroyed) return;
      const scheduledReason = this.scheduledReason;
      this.scheduledReason = 'unknown';
      const global = this.pendingGlobalRefresh;
      this.pendingGlobalRefresh = false;
      const leaves = [...this.pendingLeaves];
      this.pendingLeaves.clear();
      const task = global
        ? this.refreshAll(scheduledReason)
        : Promise.all(leaves.map((leaf) => this.refreshLeaf(leaf, scheduledReason))).then(() => undefined);
      task.catch((error: unknown) => {
        console.error('[Templar] Scheduled renderer refresh failed', error);
      });
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

  public async refreshFileIfChanged(file: TFile, reason: RefreshReason = 'metadata-change'): Promise<void> {
    if (this.destroyed) return;
    const leaves = this.app.workspace
      .getLeavesOfType('markdown')
      .filter((leaf) => leaf.view instanceof MarkdownView && leaf.view.file?.path === file.path);
    for (const leaf of leaves) {
      if (this.destroyed) return;
      const style = this.resolvedStyle(leaf);
      const fingerprint = style ? noteStyleFingerprint(style) : null;
      const rendered = this.styledViews.get(leaf);
      const hasPreview = this.previews.has(leaf);
      const unchanged = rendered?.filePath === file.path &&
        rendered.contentEl === (leaf.view as MarkdownView).contentEl &&
        !hasPreview &&
        fingerprint !== null &&
        this.styleFingerprints.get(file.path) === fingerprint;
      this.performanceMonitor?.counter(
        unchanged ? 'renderer.refreshFileIfChanged.skipped' : 'renderer.refreshFileIfChanged.refreshed',
        1,
        { reason },
      );
      if (!unchanged) await this.refreshLeaf(leaf, reason);
    }
  }

  public scheduleRefreshLeavesWithChangedRoots(reason: RefreshReason = 'layout-change'): void {
    const leaves = this.app.workspace.getLeavesOfType('markdown');
    const openLeaves = new Set(leaves);
    for (const leaf of leaves) {
      if (!(leaf.view instanceof MarkdownView)) continue;
      const previous = this.styledViews.get(leaf);
      const rootChanged = !previous ||
        previous.contentEl !== leaf.view.contentEl ||
        (previous.readingRoot !== null && !previous.readingRoot.isConnected) ||
        (previous.sourceRoot !== null && !previous.sourceRoot.isConnected);
      if (rootChanged) this.scheduleRefreshLeaf(leaf, reason);
    }
    for (const leaf of this.styledViews.keys()) {
      if (!openLeaves.has(leaf)) this.clearLeaf(leaf);
    }
  }

  public clearFile(filePath: string): void {
    for (const [leaf, state] of this.styledViews) {
      if (state.filePath === filePath) this.clearLeaf(leaf);
    }
    this.styleFingerprints.delete(filePath);
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
    const root = element.closest<HTMLElement>('.markdown-preview-view');
    if (root?.hasClass(TEMPLAR_PAGE_CLASS)) return;
    const leaf = this.app.workspace.getLeavesOfType('markdown').find((candidate) =>
      candidate.view instanceof MarkdownView &&
      candidate.view.file?.path === context.sourcePath &&
      candidate.view.contentEl.contains(element),
    );
    if (leaf) this.scheduleRefreshLeaf(leaf, 'markdown-postprocessor');
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
    this.pendingLeaves.clear();
    this.pendingGlobalRefresh = false;
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

    this.styleFingerprints.set(file.path, noteStyleFingerprint(style));
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

    const previous = this.styledViews.get(leaf);
    const roots = this.performanceMonitor
      ? this.performanceMonitor.measureSync('renderer.refreshLeaf.prepareRoots', () => this.prepareViewRoots(view.contentEl, previous))
      : this.prepareViewRoots(view.contentEl, previous);
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
    if (styleEl.textContent !== compiled.css) {
      this.performanceMonitor?.counter('renderer.refreshLeaf.styleHostWrite');
      styleEl.textContent = compiled.css;
    } else {
      this.performanceMonitor?.counter('renderer.phase.css.skipped');
    }
    const styleFingerprint = noteStyleFingerprint(style);
    const controllerKeys = this.controllerKeys(style, metrics);
    const sameRoots = previous?.contentEl === view.contentEl &&
      previous.readingRoot === roots.readingRoot &&
      previous.sourceRoot === roots.sourceRoot;
    const sameKey = (name: keyof StyledView['controllerKeys']): boolean =>
      sameRoots && previous?.controllerKeys[name] === controllerKeys[name];
    if (this.featureMask.paperOrigin && !sameKey('paperOrigin')) {
      this.paperOrigin.configure(leaf, view.contentEl, style, metrics);
    } else if (!this.featureMask.paperOrigin) {
      this.paperOrigin.clear(leaf);
    } else {
      this.performanceMonitor?.counter('renderer.phase.paperOrigin.skipped');
    }
    if (this.featureMask.imageSnap && !sameKey('imageSnap')) {
      this.imageSnap.configure(leaf, view.contentEl, style);
    } else if (!this.featureMask.imageSnap) {
      this.imageSnap.clear(leaf);
    } else {
      this.performanceMonitor?.counter('renderer.phase.imageSnap.skipped');
    }
    if (this.featureMask.variableRhythm && !sameKey('rhythm')) {
      this.rhythm.configure(leaf, view.contentEl, style);
    } else if (!this.featureMask.variableRhythm) {
      this.rhythm.clear(leaf);
    } else {
      this.performanceMonitor?.counter('renderer.phase.rhythm.skipped');
    }
    if (this.featureMask.pageLayout && !sameKey('pageLayout')) {
      this.pageLayout.configure(leaf, view.contentEl, style);
    } else if (!this.featureMask.pageLayout) {
      this.pageLayout.clear(leaf);
    } else {
      this.performanceMonitor?.counter('renderer.phase.pageLayout.skipped');
    }
    this.styledViews.set(leaf, {
      contentEl: view.contentEl,
      filePath: file.path,
      styleFingerprint,
      cssFingerprint: compiled.css,
      readingRoot: roots.readingRoot,
      sourceRoot: roots.sourceRoot,
      controllerKeys,
    });
    const readingRoot = roots.readingRoot;
    if (this.featureMask.readingWhitespace && this.settings.enableReadingView && readingRoot) {
      this.performanceMonitor?.counter('renderer.refreshLeaf.readingPrepare');
      if (!sameRoots || previous?.readingRoot !== readingRoot) {
        this.readingWhitespace.prepareCachedSections(readingRoot, file);
        this.performanceMonitor?.counter('renderer.refreshLeaf.readingActivate');
        this.readingWhitespace.activateRoot(readingRoot, file);
      } else {
        this.performanceMonitor?.counter('renderer.phase.readingWhitespace.skipped');
      }
    } else if (readingRoot) {
      if (this.featureMask.readingWhitespace) this.readingWhitespace.deactivateRoot(readingRoot);
      else this.readingWhitespace.clearRoot(readingRoot);
    }
  }

  private prepareViewRoots(contentEl: HTMLElement, previous?: StyledView): {
    readingRoot: HTMLElement | null;
    sourceRoot: HTMLElement | null;
  } {
    const readingRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-reading-view > .markdown-preview-view, :scope > .markdown-preview-view',
    );
    const sourceRoot = contentEl.querySelector<HTMLElement>(
      ':scope > .markdown-source-view.mod-cm6',
    );
    for (const oldRoot of [previous?.readingRoot, previous?.sourceRoot]) {
      if (oldRoot && oldRoot !== readingRoot && oldRoot !== sourceRoot) oldRoot.removeClass(TEMPLAR_PAGE_CLASS);
    }
    if (previous?.readingRoot && previous.readingRoot !== readingRoot) {
      previous.readingRoot.querySelector(':scope > .markdown-preview-sizer')?.removeClass(TEMPLAR_CONTENT_CLASS);
    }
    if (previous?.sourceRoot && previous.sourceRoot !== sourceRoot) {
      previous.sourceRoot.querySelector(':scope > .cm-sizer')?.removeClass(TEMPLAR_CONTENT_CLASS);
    }
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
    return { readingRoot, sourceRoot };
  }

  private controllerKeys(style: TemplarNoteStyle, metrics: unknown): StyledView['controllerKeys'] {
    return {
      pageLayout: stableFingerprint({ page: style.page, layout: style.layout, baseline: style.baseline }),
      rhythm: stableFingerprint({ baseline: style.baseline }),
      imageSnap: stableFingerprint({ baseline: style.baseline.enabled, mode: style.baseline.mode, unit: style.baseline.unit, snapImages: style.baseline.snapImages }),
      paperOrigin: stableFingerprint({ baseline: style.baseline, metrics }),
    };
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
