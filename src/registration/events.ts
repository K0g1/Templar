import { MarkdownView, Menu, TFile, type WorkspaceLeaf } from 'obsidian';
import type TemplarPlugin from '../main';
import { TEMPLAR_ICON } from '../constants';
import { runTask } from '../utils/task';

/**
 * Registers all long-lived workspace, vault, metadata, and menu events.
 *
 * Event handlers are the plugin's reactive surface. Centralizing them here
 * guarantees every listener has an owner (the plugin's registerEvent/register
 * lifecycle) and keeps `main.ts` free of inline event glue.
 *
 * Registration is split in two phases:
 * - {@link register} for events that are safe immediately at plugin load;
 * - {@link registerDeferred} for events that require the workspace layout
 *   to be ready (called from `workspace.onLayoutReady`).
 */
export class WorkspaceEventController {
  public constructor(private readonly plugin: TemplarPlugin) {}

  public register(): void {
    const { plugin } = this;
    plugin.registerEvent(
      plugin.app.workspace.on('css-change', () => {
        plugin.fontMetrics.clear();
        plugin.renderer.scheduleRefreshAll();
      }),
    );
    plugin.registerEvent(
      plugin.app.workspace.on('active-leaf-change', () => {
        const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
          if (plugin.lastMarkdownLeaf && plugin.lastMarkdownLeaf !== activeView.leaf) {
            void plugin.preview.cancelAll();
          }
          plugin.lastMarkdownLeaf = activeView.leaf;
        }
        plugin.renderer.scheduleRefreshAll();
        plugin.refreshSidebars();
        plugin.updateStatusBar();
      }),
    );
    plugin.registerEvent(
      plugin.app.workspace.on('file-open', () => {
        void runTask(() => plugin.preview.cancelMismatchedLeaves(), 'cancel mismatched leaves');
        plugin.renderer.scheduleRefreshAll();
        plugin.updateStatusBar();
      }),
    );
    plugin.registerEvent(
      plugin.app.workspace.on('layout-change', () => {
        const openLeaves = new Set<WorkspaceLeaf>();
        plugin.app.workspace.iterateAllLeaves((leaf) => openLeaves.add(leaf));
        void runTask(async () => {
          const changed = await plugin.preview.cancelMissingLeaves(openLeaves);
          if (changed) plugin.refreshSidebars();
        }, 'cancel missing leaves');
        plugin.renderer.scheduleRefreshAll();
      }),
    );
    plugin.registerEvent(
      plugin.app.metadataCache.on('changed', (file) => {
        plugin.frontmatter.settle(file);
        if (plugin.usageIndex.isBuilt()) {
          plugin.usageIndex.update({
            path: file.path,
            folder: file.parent?.path ?? '',
            style: plugin.frontmatter.getStyle(file),
          });
        }
        void runTask(() => plugin.evaluateStyleRules(file, true), 'evaluate style rules');
        void plugin.renderer.refreshFile(file);
        if (plugin.activeFile()?.path === file.path) {
          plugin.refreshSidebars();
          plugin.updateStatusBar();
        }
      }),
    );
    plugin.registerEvent(
      plugin.app.vault.on('rename', (file, oldPath) => {
        if (file instanceof TFile) {
          if (file.extension === 'md') void runTask(async () => { await plugin.preview.cancelAll(); plugin.refreshSidebars(); }, 'preview cancel');
          plugin.frontmatter.rename(oldPath, file.path);
          if (plugin.usageIndex.isBuilt()) {
            plugin.usageIndex.rename(oldPath, {
              path: file.path,
              folder: file.parent?.path ?? '',
              style: plugin.frontmatter.getStyle(file),
            });
          }
          if (file.extension === 'md') void runTask(() => plugin.evaluateStyleRules(file, true), 'evaluate style rules');
        }
        plugin.renderer.scheduleRefreshAll();
      }),
    );
    plugin.registerEvent(
      plugin.app.vault.on('delete', (file) => {
        if (file instanceof TFile && file.extension === 'md') void runTask(async () => { await plugin.preview.cancelAll(); plugin.refreshSidebars(); }, 'preview cancel');
        plugin.frontmatter.forget(file.path);
        if (plugin.usageIndex.isBuilt()) plugin.usageIndex.remove(file.path);
        plugin.renderer.scheduleRefreshAll();
      }),
    );
    plugin.registerEvent(
      plugin.app.workspace.on('editor-menu', (menu: Menu) => {
        const file = plugin.activeFile();
        if (!file) {
          return;
        }
        menu.addSeparator();
        menu.addItem((item) =>
          item
            .setTitle('Apply page style…')
            .setIcon(TEMPLAR_ICON)
            .onClick(() => plugin.showStylePicker(file)),
        );
        if (plugin.frontmatter.hasStyle(file)) {
          menu.addItem((item) =>
            item
              .setTitle('Customize current note…')
              .setIcon('sliders-horizontal')
              .onClick(() => plugin.showCurrentNoteInspector(file)),
          );
          menu.addItem((item) =>
            item
              .setTitle('Remove page style')
              .setIcon('eraser')
              .onClick(() => void plugin.removeStyle(file)),
          );
        }
      }),
    );
    plugin.registerMarkdownPostProcessor((element, context) => {
      plugin.renderer.registerReadingSection(element, context);
      plugin.renderer.scheduleRefreshAll();
    });
  }

  /**
   * Registers layout-dependent events. Call from inside
   * `workspace.onLayoutReady()` so leaf bookkeeping starts from the real
   * active view.
   */
  public registerDeferred(): void {
    const { plugin } = this;
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (activeView) {
      plugin.lastMarkdownLeaf = activeView.leaf;
    }
    plugin.styleController.markRulesReady();
    plugin.registerEvent(plugin.app.vault.on('create', (file) => {
      if (file instanceof TFile && file.extension === 'md') {
        void plugin.styleController.evaluateStyleRules(file, false);
      }
    }));
  }
}
