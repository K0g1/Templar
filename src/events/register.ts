import { MarkdownView, Menu, TFile, type EventRef } from 'obsidian';
import { TEMPLAR_ICON } from '../constants';
import type TemplarPlugin from '../main';

export function registerEvent(plugin: TemplarPlugin, eventRef: EventRef): void {
  plugin.registerEvent(eventRef);
}

/** Register workspace, metadata, vault, and editor events after composition. */
export function registerEvents(plugin: TemplarPlugin): void {
  registerEvent(plugin,
    plugin.app.workspace.on('css-change', () => {
      plugin.fontMetrics.clear();
      plugin.renderer.scheduleRefreshAll();
    }),
  );
  registerEvent(plugin,
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
  registerEvent(plugin,
    plugin.app.workspace.on('file-open', () => {
      void plugin.preview.cancelMismatchedLeaves();
      plugin.renderer.scheduleRefreshAll();
      plugin.updateStatusBar();
    }),
  );
  registerEvent(plugin,
    plugin.app.workspace.on('layout-change', () => {
      // During a Reading/Editing mode rebuild, iterateAllLeaves can omit the
      // active Markdown leaf for one layout event even though the leaf is
      // still connected and getLeavesOfType already reports it. Preview
      // sessions are Markdown-only, so use the authoritative typed list and
      // avoid cancelling a try-on merely because the renderer was swapped.
      const openLeaves = new Set(plugin.app.workspace.getLeavesOfType('markdown'));
      void plugin.preview.cancelMissingLeaves(openLeaves).then((changed) => {
        if (changed) plugin.refreshSidebars();
      });
      plugin.renderer.scheduleRefreshAll();
    }),
  );
  registerEvent(plugin,
    plugin.app.metadataCache.on('changed', (file) => {
      plugin.frontmatter.settle(file);
      if (plugin.usageIndex.isBuilt()) {
        plugin.usageIndex.update({ path: file.path, folder: file.parent?.path ?? '', style: plugin.frontmatter.getStyle(file) });
      }
      void plugin.evaluateStyleRules(file, true);
      void plugin.renderer.refreshFile(file);
      if (plugin.activeFile()?.path === file.path) {
        plugin.refreshSidebars();
        plugin.updateStatusBar();
      }
    }),
  );
  registerEvent(plugin,
    plugin.app.vault.on('rename', (file, oldPath) => {
      if (file instanceof TFile) {
        if (file.extension === 'md') void plugin.preview.cancelAll().then(() => plugin.refreshSidebars());
        plugin.frontmatter.rename(oldPath, file.path);
        if (plugin.usageIndex.isBuilt()) {
          plugin.usageIndex.rename(oldPath, { path: file.path, folder: file.parent?.path ?? '', style: plugin.frontmatter.getStyle(file) });
        }
        if (file.extension === 'md') void plugin.evaluateStyleRules(file, true);
      }
      plugin.renderer.scheduleRefreshAll();
    }),
  );
  registerEvent(plugin,
    plugin.app.vault.on('delete', (file) => {
      if (file instanceof TFile && file.extension === 'md') void plugin.preview.cancelAll().then(() => plugin.refreshSidebars());
      plugin.frontmatter.forget(file.path);
      if (plugin.usageIndex.isBuilt()) plugin.usageIndex.remove(file.path);
      plugin.renderer.scheduleRefreshAll();
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
