import type TemplarPlugin from '../main';
import { DEFAULT_TEMPLATE_ID } from '../constants';

/**
 * Registers all Templar Obsidian commands.
 *
 * Command definitions are declarative mappings onto plugin methods. Keeping
 * them in a dedicated registrar means `main.ts` does not grow when new
 * commands are added, and every command has a single documented home.
 */
export class CommandRegistrar {
  public constructor(private readonly plugin: TemplarPlugin) {}

  public register(): void {
    const { plugin } = this;
    plugin.addCommand({
      id: 'open-page-styles',
      name: 'Open page styles',
      callback: () => void plugin.openStylesView(),
    });
    plugin.addCommand({
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
    plugin.addCommand({
      id: 'focus-style-search',
      name: 'Focus style search',
      callback: () => void plugin.focusStyleSearch(),
    });
    plugin.addCommand({
      id: 'customize-current-note',
      name: 'Customize current note',
      checkCallback: (checking) => {
        const file = plugin.activeFile();
        const available = file !== null && plugin.frontmatter.hasStyle(file);
        if (available && !checking) plugin.showCurrentNoteInspector(file);
        return available;
      },
    });
    plugin.addCommand({
      id: 'apply-last-used-style',
      name: 'Apply last used style',
      checkCallback: (checking) => {
        const file = plugin.activeFile();
        const template = plugin.library.get(plugin.settings.recentTemplateIds[0] ?? '');
        const available = file !== null && template !== null;
        if (available && !checking) void plugin.applyTemplate(template, file);
        return available;
      },
    });
    plugin.addCommand({
      id: 'next-favorite-style',
      name: 'Next favorite style',
      checkCallback: (checking) => {
        const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0;
        if (available && !checking) void plugin.cycleFavouritePreview(1);
        return available;
      },
    });
    plugin.addCommand({
      id: 'previous-favorite-style',
      name: 'Previous favorite style',
      checkCallback: (checking) => {
        const available = plugin.activeFile() !== null && plugin.settings.favouriteTemplateIds.length > 0;
        if (available && !checking) void plugin.cycleFavouritePreview(-1);
        return available;
      },
    });
    plugin.addCommand({
      id: 'apply-previewed-style',
      name: 'Apply previewed style',
      checkCallback: (checking) => {
        const available = plugin.preview.current() !== null;
        if (available && !checking) void plugin.applyCurrentPreview();
        return available;
      },
    });
    plugin.addCommand({
      id: 'cancel-style-preview',
      name: 'Cancel style preview',
      checkCallback: (checking) => {
        const available = plugin.preview.current() !== null;
        if (available && !checking) void plugin.preview.cancelAll().then(() => plugin.refreshSidebars());
        return available;
      },
    });
    plugin.addCommand({
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
    plugin.addCommand({
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
    plugin.addCommand({
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
    plugin.addCommand({
      id: 'create-page-style',
      name: 'Create page style…',
      callback: () => plugin.showTemplateCreator(),
    });
    plugin.addCommand({
      id: 'create-styled-note',
      name: 'Create styled note…',
      callback: () => plugin.showNewNoteStylePicker(),
    });
    plugin.addCommand({
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
    plugin.addCommand({
      id: 'toggle-paged-pageless',
      name: 'Toggle paged / pageless',
      checkCallback: (checking) => {
        const file = plugin.activeFile();
        const style = file ? plugin.frontmatter.getStyle(file) : null;
        if (file && style && !checking) {
          style.page.mode = style.page.mode === 'paged' ? 'pageless' : 'paged';
          void plugin.writeAndRefresh(file, style);
        }
        return Boolean(file && style);
      },
    });
    plugin.addCommand({
      id: 'toggle-fit-narrow-screens',
      name: 'Toggle fit narrow screens',
      checkCallback: (checking) => {
        const file = plugin.activeFile();
        const style = file ? plugin.frontmatter.getStyle(file) : null;
        const available = Boolean(file && style?.page.mode === 'paged');
        if (available && !checking && file && style) {
          style.page.scaleToFit = !style.page.scaleToFit;
          void plugin.writeAndRefresh(file, style);
        }
        return available;
      },
    });
    plugin.addCommand({
      id: 'review-template-updates',
      name: 'Review template updates',
      callback: () => plugin.showSynchronizationReview(),
    });
    plugin.addCommand({
      id: 'manage-style-rules',
      name: 'Manage style rules',
      callback: () => plugin.showStyleRules(),
    });
    plugin.addCommand({
      id: 'print-export-styled-note',
      name: 'Print / export styled note',
      checkCallback: (checking) => {
        const file = plugin.activeFile();
        const leaf = plugin.activeMarkdownLeaf();
        const available = Boolean(file && leaf && plugin.frontmatter.hasStyle(file) && plugin.printService.available(leaf));
        if (available && !checking) void plugin.printStyledNote(file);
        return available;
      },
    });
    plugin.addCommand({
      id: 'import-page-style',
      name: 'Import page style…',
      callback: () => plugin.showTemplateImporter(),
    });
    plugin.addCommand({
      id: 'batch-apply-page-style',
      name: 'Apply page style to multiple notes…',
      callback: () => plugin.showBatchApply(),
    });
    plugin.addCommand({
      id: 'copy-template-authoring-skill',
      name: 'Copy LLM template authoring skill',
      callback: () => void plugin.copyAuthoringKit(),
    });
  }
}
