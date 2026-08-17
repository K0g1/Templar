import { DEFAULT_TEMPLATE_ID } from '../constants';
import type TemplarPlugin from '../main';
import type { Plugin } from 'obsidian';
import { runUserAction } from '../ui/async-actions';
import { TEMPLAR_PERF_ENABLED } from '../performance/performance-types';
import { registerPerformanceCommands } from '../performance/profile-commands';

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
  if (TEMPLAR_PERF_ENABLED) registerPerformanceCommands(plugin);
  registerCommand(plugin, {
    id: 'open-templar-recovery',
    name: 'Open Templar recovery for current note',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const available = file !== null && plugin.frontmatter.hasTemplarData(file);
      if (available && !checking) plugin.showRecovery(file);
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'open-page-styles',
    name: 'Open page styles',
    callback: () => runUserAction(() => plugin.openStylesView(), 'Could not open Page Styles'),
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
  registerCommand(plugin, {
    id: 'focus-style-search',
    name: 'Focus style search',
    callback: () => runUserAction(() => plugin.focusStyleSearch(), 'Could not focus style search'),
  });
  registerCommand(plugin, {
    id: 'customize-current-note',
    name: 'Customize current note',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const available = file !== null && plugin.frontmatter.hasStyle(file);
      if (available && !checking && file) plugin.showCurrentNoteInspector(file);
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'apply-last-used-style',
    name: 'Apply last used style',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const template = plugin.library.get(plugin.settings.recentTemplateIds[0] ?? '');
      const available = file !== null && template !== null;
      if (available && !checking && file && template) runUserAction(() => plugin.applyTemplate(template, file), 'Could not apply the page style');
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'next-favorite-style',
    name: 'Next favorite style',
    checkCallback: (checking) => {
      const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0;
      if (available && !checking) runUserAction(() => plugin.cycleFavouritePreview(1), 'Could not preview the next favorite style');
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'previous-favorite-style',
    name: 'Previous favorite style',
    checkCallback: (checking) => {
      const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0;
      if (available && !checking) runUserAction(() => plugin.cycleFavouritePreview(-1), 'Could not preview the previous favorite style');
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'apply-previewed-style',
    name: 'Apply previewed style',
    checkCallback: (checking) => {
      const leaf = plugin.activeMarkdownLeaf();
      const available = leaf !== null && plugin.preview.currentForLeaf(leaf) !== null;
      if (available && !checking) runUserAction(() => plugin.applyCurrentPreview(leaf), 'Could not apply the previewed style');
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'cancel-style-preview',
    name: 'Cancel style preview',
    checkCallback: (checking) => {
      const leaf = plugin.activeMarkdownLeaf();
      const session = leaf ? plugin.preview.currentForLeaf(leaf) : null;
      if (session && !checking) {
        runUserAction(async () => { await plugin.preview.cancel(session.owner); plugin.refreshSidebars(); }, 'Could not cancel the style preview');
      }
      return session !== null;
    },
  });
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
          runUserAction(() => plugin.applyTemplate(template, file), 'Could not apply the default page style');
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
        runUserAction(() => plugin.removeStyle(file), 'Could not remove the page style');
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
    id: 'toggle-paged-pageless',
    name: 'Toggle paged / pageless',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const style = file ? plugin.frontmatter.getStyle(file) : null;
      if (file && style && !checking) {
        style.page.mode = style.page.mode === 'paged' ? 'pageless' : 'paged';
        runUserAction(() => plugin.writeAndRefresh(file, style), 'Could not toggle page mode');
      }
      return Boolean(file && style);
    },
  });
  registerCommand(plugin, {
    id: 'toggle-fit-narrow-screens',
    name: 'Toggle fit narrow screens',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const style = file ? plugin.frontmatter.getStyle(file) : null;
      const available = Boolean(file && style?.page.mode === 'paged');
      if (available && !checking && file && style) {
        style.page.scaleToFit = !style.page.scaleToFit;
        runUserAction(() => plugin.writeAndRefresh(file, style), 'Could not toggle narrow-screen fitting');
      }
      return available;
    },
  });
  registerCommand(plugin, {
    id: 'review-template-updates',
    name: 'Review template updates',
    callback: () => plugin.showSynchronizationReview(),
  });
  registerCommand(plugin, {
    id: 'manage-style-rules',
    name: 'Manage style rules',
    callback: () => plugin.showStyleRules(),
  });
  registerCommand(plugin, {
    id: 'print-export-styled-note',
    name: 'Print / export styled note',
    checkCallback: (checking) => {
      const file = plugin.activeFile();
      const leaf = plugin.activeMarkdownLeaf();
      const available = Boolean(
        file && leaf && plugin.frontmatter.hasStyle(file) && plugin.printService.available(leaf),
      );
      if (available && !checking && file) runUserAction(() => plugin.printStyledNote(file), 'Could not print the styled note');
      return available;
    },
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
    callback: () => runUserAction(() => plugin.copyAuthoringKit(), 'Could not copy the authoring kit'),
  });
}
