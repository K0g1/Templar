import { MarkdownView, Menu, TFile, type EventRef } from 'obsidian';
import { TEMPLAR_ICON } from '../constants';
import type TemplarPlugin from '../main';
import { runBackgroundTask, runUserAction } from '../ui/async-actions';

export function registerEvent(plugin: TemplarPlugin, eventRef: EventRef): void {
  plugin.registerEvent(eventRef);
}

/** Register workspace, metadata, vault, and editor events after composition. */
export function registerEvents(plugin: TemplarPlugin): void {
  registerEvent(plugin,
    plugin.app.workspace.on('css-change', () => {
      plugin.perf.counter('events.css-change.count');
      plugin.fontMetrics.clear();
      plugin.renderer.scheduleRefreshAll('css-change');
    }),
  );
  registerEvent(plugin,
    plugin.app.workspace.on('active-leaf-change', () => {
      plugin.perf.counter('events.active-leaf-change.count');
      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) {
        if (plugin.lastMarkdownLeaf && plugin.lastMarkdownLeaf !== activeView.leaf) {
          runBackgroundTask(() => plugin.preview.cancelAll(), 'preview cleanup after active leaf change');
        }
        plugin.lastMarkdownLeaf = activeView.leaf;
      }
      if (activeView) plugin.renderer.scheduleRefreshLeaf(activeView.leaf, 'active-leaf-change');
      plugin.refreshSidebars();
      plugin.updateStatusBar();
    }),
  );
  registerEvent(plugin,
    plugin.app.workspace.on('file-open', () => {
      plugin.perf.counter('events.file-open.count');
      runBackgroundTask(() => plugin.preview.cancelMismatchedLeaves(), 'preview cleanup after file open');
      const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);
      if (activeView) plugin.renderer.scheduleRefreshLeaf(activeView.leaf, 'file-open');
      plugin.updateStatusBar();
    }),
  );
  registerEvent(plugin,
    plugin.app.workspace.on('layout-change', () => {
      plugin.perf.counter('events.layout-change.count');
      // During a Reading/Editing mode rebuild, iterateAllLeaves can omit the
      // active Markdown leaf for one layout event even though the leaf is
      // still connected and getLeavesOfType already reports it. Preview
      // sessions are Markdown-only, so use the authoritative typed list and
      // avoid cancelling a try-on merely because the renderer was swapped.
      const openLeaves = new Set(plugin.app.workspace.getLeavesOfType('markdown'));
      runBackgroundTask(async () => {
        const changed = await plugin.preview.cancelMissingLeaves(openLeaves);
        if (changed) plugin.refreshSidebars();
      }, 'preview cleanup after layout change');
      plugin.renderer.scheduleRefreshLeavesWithChangedRoots('layout-change');
    }),
  );
  registerEvent(plugin,
    plugin.app.metadataCache.on('changed', (file) => {
      plugin.perf.counter('events.metadata-changed.count');
      const beforeFingerprint = plugin.renderer.lastKnownStyleFingerprint(file.path);
      plugin.frontmatter.settle(file);
      if (plugin.usageIndex.isBuilt()) {
        plugin.usageIndex.update({ path: file.path, folder: file.parent?.path ?? '', style: plugin.frontmatter.getStyle(file) });
      }
      runBackgroundTask(() => plugin.evaluateStyleRules(file, true), 'style rule evaluation after metadata change');
      const afterFingerprint = plugin.frontmatter.inspect(file).fingerprint;
      if (beforeFingerprint === null) {
        plugin.perf.counter('metadata.styleFingerprint.unknown');
      } else {
        plugin.perf.counter(
          beforeFingerprint === afterFingerprint
            ? 'metadata.styleFingerprint.unchanged'
            : 'metadata.styleFingerprint.changed',
        );
      }
      plugin.perf.event('metadata.changed', {
        fingerprintKnown: beforeFingerprint !== null,
        fingerprintChanged: beforeFingerprint === null ? null : beforeFingerprint !== afterFingerprint,
      });
      runBackgroundTask(() => plugin.renderer.refreshFileIfChanged(file, 'metadata-change'), 'renderer refresh after metadata change');
      if (plugin.activeFile()?.path === file.path) {
        plugin.refreshSidebars();
        plugin.updateStatusBar();
      }
    }),
  );
  registerEvent(plugin,
    plugin.app.vault.on('rename', (file, oldPath) => {
      plugin.perf.counter('events.vault-rename.count');
      if (file instanceof TFile) {
        plugin.renderer.forgetStyleFingerprint(oldPath);
        if (file.extension === 'md') runBackgroundTask(async () => { await plugin.preview.cancelAll(); plugin.refreshSidebars(); }, 'preview cleanup after rename');
        plugin.frontmatter.rename(oldPath, file.path);
        if (plugin.usageIndex.isBuilt()) {
          plugin.usageIndex.rename(oldPath, { path: file.path, folder: file.parent?.path ?? '', style: plugin.frontmatter.getStyle(file) });
        }
        if (file.extension === 'md') runBackgroundTask(() => plugin.evaluateStyleRules(file, true), 'style rule evaluation after rename');
      }
      if (file instanceof TFile && file.extension === 'md') {
        runBackgroundTask(() => plugin.renderer.refreshFile(file, 'rename'), 'renderer refresh after rename');
      }
    }),
  );
  registerEvent(plugin,
    plugin.app.vault.on('delete', (file) => {
      plugin.perf.counter('events.vault-delete.count');
      if (file instanceof TFile && file.extension === 'md') runBackgroundTask(async () => { await plugin.preview.cancelAll(); plugin.refreshSidebars(); }, 'preview cleanup after delete');
      plugin.frontmatter.forget(file.path);
      plugin.renderer.forgetStyleFingerprint(file.path);
      if (plugin.usageIndex.isBuilt()) plugin.usageIndex.remove(file.path);
      plugin.renderer.clearFile(file.path);
    }),
  );
  registerEvent(plugin,
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
            .onClick(() => runUserAction(() => plugin.removeStyle(file), 'Could not remove the page style')),
        );
      }
    }),
  );
  plugin.registerMarkdownPostProcessor((element, context) => {
    plugin.perf.counter('events.markdown-postprocessor.count');
    plugin.renderer.registerReadingSection(element, context);
  });
}
