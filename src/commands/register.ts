import { DEFAULT_TEMPLATE_ID } from '../constants';
import type TemplarPlugin from '../main';
import type { Plugin } from 'obsidian';

type CommandDefinition = Parameters<Plugin['addCommand']>[0];

/** Keep command registration mechanics out of the plugin composition root. */
export function registerCommand(
  plugin: Pick<Plugin, 'addCommand'>,
  command: CommandDefinition,
): void {
  plugin.addCommand(command);
}

/** Register all Templar commands against the already-composed plugin services. */
export function registerCommands(plugin: TemplarPlugin): void {
  registerCommand(plugin, {
    id: 'open-page-styles',
    name: 'Open page styles',
    callback: () => void plugin.openStylesView(),
  });
  registerCommand(plugin, {
    id: 'choose-page-style',
    name: 'Choose page style…',
    checkCallback: (checking) => {
      const available = plugin.activeFile() !== null;
      if (available && !checking) {
        plugin.showStylePicker();
      }
      return available;
    },
  });
  registerCommand(plugin, { id: 'focus-style-search', name: 'Focus style search', callback: () => void plugin.focusStyleSearch() });
  registerCommand(plugin, {
    id: 'customize-current-note', name: 'Customize current note',
    checkCallback: (checking) => {
      const file = plugin.activeFile(); const available = file !== null && plugin.frontmatter.hasStyle(file);
      if (available && !checking) plugin.showCurrentNoteInspector(file);
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'apply-last-used-style', name: 'Apply last used style',
    checkCallback: (checking) => {
      const file = plugin.activeFile(); const template = plugin.library.get(plugin.settings.recentTemplateIds[0] ?? '');
      const available = file !== null && template !== null;
      if (available && !checking) void plugin.applyTemplate(template, file);
      return available;
    },
  });
  registerCommand(plugin, { id: 'next-favorite-style', name: 'Next favorite style', checkCallback: (checking) => { const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0; if (available && !checking) void plugin.cycleFavouritePreview(1); return available; } });
  registerCommand(plugin, { id: 'previous-favorite-style', name: 'Previous favorite style', checkCallback: (checking) => { const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0; if (available && !checking) void plugin.cycleFavouritePreview(-1); return available; } });
  registerCommand(plugin, { id: 'apply-previewed-style', name: 'Apply previewed style', checkCallback: (checking) => { const available = plugin.preview.current() !== null; if (available && !checking) void plugin.applyCurrentPreview(); return available; } });
  registerCommand(plugin, { id: 'cancel-style-preview', name: 'Cancel style preview', checkCallback: (checking) => { const available = plugin.preview.current() !== null; if (available && !checking) void plugin.preview.cancelAll().then(() => plugin.refreshSidebars()); return available; } });
  registerCommand(plugin, {
    id: 'apply-default-page-style',
    name: 'Apply default page style',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      if (!file) {
        return false;
      }
      if (!checking) {
        const template =
          plugin.library.get(plugin.settings.defaultTemplateId) ??
          plugin.library.get(DEFAULT_TEMPLATE_ID);
        if (template) {
          void plugin.applyTemplate(template, file);
        }
      }
      return true;
    },
  });
  registerCommand(plugin, {
    id: 'remove-page-style',
    name: 'Remove page style',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const available = file !== null && plugin.frontmatter.hasStyle(file);
      if (available && !checking) {
        void plugin.removeStyle(file);
      }
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'edit-raw-style',
    name: 'Edit raw style…',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const available = file !== null && plugin.frontmatter.hasStyle(file);
      if (available && !checking) {
        plugin.showRawStyleEditor();
      }
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'create-page-style',
    name: 'Create page style…',
    callback: () => plugin.showTemplateCreator(),
  });
  registerCommand(plugin, {
    id: 'create-styled-note',
    name: 'Create styled note…',
    callback: () => plugin.showNewNoteStylePicker(),
  });
  registerCommand(plugin, {
    id: 'change-page-mode',
    name: 'Change page mode…',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const available = file !== null && plugin.frontmatter.hasStyle(file);
      if (available && !checking) {
        plugin.showPageMode();
      }
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'toggle-paged-pageless', name: 'Toggle paged / pageless',
    checkCallback: (checking) => {
      const file = plugin.activeFile(); const style = file ? plugin.frontmatter.getStyle(file) : null;
      if (file && style && !checking) { style.page.mode = style.page.mode === 'paged' ? 'pageless' : 'paged'; void plugin.writeAndRefresh(file, style); }
      return Boolean(file && style);
    },
  });
  registerCommand(plugin, {
    id: 'toggle-fit-narrow-screens', name: 'Toggle fit narrow screens',
    checkCallback: (checking) => {
      const file = plugin.activeFile(); const style = file ? plugin.frontmatter.getStyle(file) : null;
      const available = Boolean(file && style?.page.mode === 'paged');
      if (available && !checking && file && style) { style.page.scaleToFit = !style.page.scaleToFit; void plugin.writeAndRefresh(file, style); }
      return available;
    },
  });
  registerCommand(plugin, { id: 'review-template-updates', name: 'Review template updates', callback: () => plugin.showSynchronizationReview() });
  registerCommand(plugin, { id: 'manage-style-rules', name: 'Manage style rules', callback: () => plugin.showStyleRules() });
  registerCommand(plugin, {
    id: 'print-export-styled-note', name: 'Print / export styled note',
    checkCallback: (checking) => { const file = plugin.activeFile(); const leaf = plugin.activeMarkdownLeaf(); const available = Boolean(file && leaf && plugin.frontmatter.hasStyle(file) && plugin.printService.available(leaf)); if (available && !checking) void plugin.printStyledNote(file); return available; },
  });
  registerCommand(plugin, {
    id: 'import-page-style',
    name: 'Import page style…',
    callback: () => plugin.showTemplateImporter(),
  });
  registerCommand(plugin, {
    id: 'batch-apply-page-style',
    name: 'Apply page style to multiple notes…',
    callback: () => plugin.showBatchApply(),
  });
  registerCommand(plugin, {
    id: 'copy-template-authoring-skill',
    name: 'Copy LLM template authoring skill',
    callback: () => void plugin.copyAuthoringKit(),
  });
}

