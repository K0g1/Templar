import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_TEMPLATE_ID, VIRTUAL_SELECTORS } from '../constants';
import type TemplarPlugin from '../main';
import { DEFAULT_SETTINGS } from '../templates/defaults';
import { clone } from '../utils/value';
import { ConfirmationModal } from './modals';
import { renderIssues } from './issues';
import { renderTemplatePreview } from './template-preview';
import { writeTextToClipboard } from '../utils/clipboard';
import { runBackgroundTask, runUserAction } from './async-actions';

export class TemplarSettingTab extends PluginSettingTab {
  public constructor(
    app: App,
    private readonly plugin: TemplarPlugin,
  ) {
    super(app, plugin);
  }

  public display(): void {
    this.render();
  }

  private render(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.addClass('templar-settings');

    new Setting(containerEl)
      .setName('Style reading view')
      .setDesc('Render styled notes in reading view.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableReadingView).onChange((value) => {
          void this.commitSetting('reading view setting', (draft) => { draft.enableReadingView = value; }, { refresh: true });
        }),
      );
    new Setting(containerEl)
      .setName('Style live preview')
      .setDesc('Render the same page style while editing Markdown.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLivePreview).onChange((value) => {
          void this.commitSetting('Live Preview setting', (draft) => { draft.enableLivePreview = value; }, { refresh: true });
        }),
      );
    new Setting(containerEl)
      .setName('Hide templar metadata')
      .setDesc('Collapse the templar YAML block during ordinary editing. Use “edit raw style” to inspect it.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hideStyleMetadata).onChange((value) => {
          void this.commitSetting('metadata visibility setting', (draft) => { draft.hideStyleMetadata = value; }, { refresh: true });
        }),
      );

    const templates = this.plugin.library.all();
    const options: Record<string, string> = {};
    for (const template of templates) {
      options[template.id] = template.name;
    }
    new Setting(containerEl)
      .setName('Default page style')
      .setDesc('Used by the “apply default page style” command.')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions(options)
          .setValue(this.plugin.settings.defaultTemplateId)
          .onChange((value) => {
            void this.commitSetting('default page style', (draft) => { draft.defaultTemplateId = value; });
          }),
      );
    new Setting(containerEl)
      .setName('Default page flow for newly styled notes')
      .setDesc('Used by one-click apply when the note has no existing templar page settings.')
      .addDropdown((dropdown) => dropdown
        .addOptions({ pageless: 'Pageless', 'paged-a4': 'Paged A4', 'paged-letter': 'Paged Letter' })
        .setValue(this.plugin.settings.defaultNewPageFlow)
        .onChange((value) => {
          void this.commitSetting('default page flow', (draft) => {
            draft.defaultNewPageFlow = value as typeof draft.defaultNewPageFlow;
          });
        }));

    new Setting(containerEl).setName('Template library').setHeading();
    containerEl.createEl('p', {
      text: `${String(this.plugin.library.builtIns().length)} built-in and ${String(this.plugin.library.userTemplates().length)} custom Page Styles are installed. Applying a style copies its complete design into the note.`,
    });
    new Setting(containerEl)
      .setName('Open page styles')
      .setDesc('Preview, apply, customize, duplicate, export, and delete styles.')
      .addButton((button) =>
        button.setButtonText('Open library').onClick(() => runUserAction(() => this.plugin.openStylesView(), 'Could not open Page Styles')),
      );
    new Setting(containerEl)
      .setName('Create a page style')
      .setDesc('Use simple mode controls or advanced mode CSS with a live preview.')
      .addButton((button) =>
        button.setButtonText('Open template creator').setCta().onClick(() => this.plugin.showTemplateCreator()),
      );
    new Setting(containerEl)
      .setName('Import a page style')
      .setDesc('Validate and preview template YAML before it enters the library.')
      .addButton((button) =>
        button.setButtonText('Import…').onClick(() => this.plugin.showTemplateImporter()),
      );

    new Setting(containerEl).setName('Style rules').setHeading();
    containerEl.createEl('p', {
      text: `${String(this.plugin.settings.styleRules.length)} automatic ${this.plugin.settings.styleRules.length === 1 ? 'rule' : 'rules'} configured. Rules only style unstyled notes and never run a background vault scan.`,
    });
    new Setting(containerEl)
      .setName('Manage style rules')
      .setDesc('Create ordered folder, tag, filename, and frontmatter rules; preview existing matches before any bulk operation.')
      .addButton((button) => button.setButtonText('Manage rules…').onClick(() => this.plugin.showStyleRules()));

    new Setting(containerEl).setName('Typography and baseline').setHeading();
    new Setting(containerEl)
      .setName('Default vertical rhythm')
      .setDesc('Starting grid unit for new page styles. Existing notes keep their embedded value.')
      .addSlider((slider) =>
        slider
          .setLimits(16, 60, 1)
          .setValue(this.plugin.settings.defaultGridUnit)
          .onChange((value) => {
            void this.commitSetting('default vertical rhythm', (draft) => { draft.defaultGridUnit = value; });
          }),
      );
    new Setting(containerEl)
      .setName('Font calibration cache')
      .setDesc('Maximum measured font combinations retained in memory. The cache clears when the plugin unloads.')
      .addSlider((slider) =>
        slider
          .setLimits(16, 256, 8)
          .setValue(this.plugin.settings.fontCacheSize)
          .onChange((value) => {
            void this.commitSetting('font calibration cache size', (draft) => { draft.fontCacheSize = value; });
          }),
      )
      .addButton((button) =>
        button.setButtonText('Clear cache').onClick(() => {
          this.plugin.fontMetrics.clear();
          this.plugin.renderer.scheduleRefreshAll();
          new Notice('Cleared font measurements.');
        }),
      );
    const diagnostic = containerEl.createDiv({ cls: 'templar-baseline-diagnostic' });
    diagnostic.createDiv({ cls: 'templar-section-label', text: 'Baseline diagnostic' });
    const preview = diagnostic.createDiv({ cls: 'templar-preview-container' });
    const selected =
      this.plugin.library.get(this.plugin.settings.defaultTemplateId) ??
      this.plugin.library.get(DEFAULT_TEMPLATE_ID);
    if (selected) {
      runBackgroundTask(() => renderTemplatePreview(preview, selected, this.plugin.fontMetrics), 'Could not render the settings preview');
    }

    new Setting(containerEl).setName('AI / LLM template builder').setHeading();
    containerEl.createEl('p', {
      text: 'Templar does not send notes to an AI service and requires no API key. The authoring skill is a portable instruction document you can paste into any capable model.',
    });
    new Setting(containerEl)
      .setName('Template authoring skill')
      .setDesc('Includes the v1 schema, selectors, safety rules, performance guidance, and a complete example.')
      .addButton((button) =>
        button.setButtonText('Copy instructions').setCta().onClick(() => runUserAction(() => this.plugin.copyAuthoringKit(), 'Could not copy the authoring instructions')),
      )
      .addButton((button) =>
        button.setButtonText('Export to vault').onClick(() => runUserAction(() => this.plugin.exportAuthoringKit(), 'Could not export the authoring instructions')),
      );
    new Setting(containerEl)
      .setName('Import AI-generated template')
      .setDesc('Opens the same validator and isolated preview used for every imported template.')
      .addButton((button) =>
        button.setButtonText('Import and validate…').onClick(() => this.plugin.showTemplateImporter()),
      );

    new Setting(containerEl).setName('Advanced').setHeading();
    const file = this.plugin.activeFile();
    if (file && this.plugin.frontmatter.hasStyle(file)) {
      new Setting(containerEl)
        .setName('Active note style data')
        .setDesc('Open the normalized YAML editor without exposing templar metadata during everyday writing.')
        .addButton((button) =>
          button.setButtonText('Edit raw style…').onClick(() => this.plugin.showRawStyleEditor()),
        );
      const issues = this.plugin.renderer.issuesFor(file);
      const issueContainer = containerEl.createDiv();
      renderIssues(issueContainer, issues);
    }
    if (this.plugin.quarantinedTemplates.length > 0) {
      new Setting(containerEl).setName('Invalid saved styles').setHeading();
      containerEl.createEl('p', {
        text: `${String(this.plugin.quarantinedTemplates.length)} saved style entr${this.plugin.quarantinedTemplates.length === 1 ? 'y was' : 'ies were'} quarantined and will not be loaded until you explicitly remove them.`,
      });
      for (const entry of this.plugin.quarantinedTemplates) {
        const raw = JSON.stringify(entry.raw, null, 2) ?? String(entry.raw);
        const warning = entry.futureVersion
          ? 'This appears to come from a newer Templar version; removing it may discard data that this version cannot understand.'
          : entry.message;
        new Setting(containerEl)
          .setName(entry.templateId ? `Entry ${entry.templateId}` : `Entry ${String(entry.index + 1)}`)
          .setDesc(`${warning} Raw data is retained until you choose an action.`)
          .addButton((button) => button.setButtonText('Copy raw data').onClick(() => {
            writeTextToClipboard(raw)
              .then(() => new Notice('Copied quarantined style data.'))
              .catch((error) => new Notice(error instanceof Error ? error.message : String(error)));
          }))
          .addButton((button) => button.setButtonText('Remove invalid saved entry').onClick(() => {
            new ConfirmationModal(
              this.plugin,
              'Remove invalid saved style entry?',
              entry.futureVersion
                ? 'This entry may have been written by a newer Templar version. Removing it can discard data that cannot be recovered here.'
                : 'This removes the invalid saved entry from Templar settings. The raw data will no longer be retained.',
              async () => {
                try {
                  await this.plugin.removeQuarantinedTemplate(entry.index);
                  this.render();
                  new Notice('Removed invalid saved style entry.');
                } catch (error) {
                  new Notice(`Templar could not remove the saved entry: ${error instanceof Error ? error.message : String(error)}`);
                }
              },
              'Remove invalid saved entry',
            ).open();
          }));
      }
    }
    const selectorDetails = containerEl.createEl('details');
    selectorDetails.createEl('summary', { text: 'Templar selector reference' });
    const selectorList = selectorDetails.createEl('ul');
    for (const selector of VIRTUAL_SELECTORS) {
      selectorList.createEl('li').createEl('code', { text: selector });
    }
    const architecture = containerEl.createEl('p');
    architecture.appendText('See ');
    architecture.createEl('code', { text: 'docs/ARCHITECTURE.md' });
    architecture.appendText(' in the Templar plugin folder for renderer, schema, security, and extension points.');

    new Setting(containerEl).setName('Reset').setHeading();
    new Setting(containerEl)
      .setName('Reset all settings')
      .setDesc('Restores every option to its default value. Custom styles are kept; favorites, recents, and style rules are cleared.')
      .addButton((button) => {
        button
          .setButtonText('Reset to defaults')
          .onClick(() => this.confirmReset());
        button.buttonEl.addClass('mod-warning');
      });
  }

  private confirmReset(): void {
    new ConfirmationModal(
      this.plugin,
      'Reset all Templar settings?',
      'Every option returns to its default value. Custom page styles are kept; favorites, recents, and style rules are cleared.',
      async () => {
        const defaults = clone(DEFAULT_SETTINGS);
        const committed = await this.commitSetting('settings reset', (draft) => {
          defaults.userTemplates = clone(draft.userTemplates);
          Object.assign(draft, defaults);
        }, { refresh: true });
        if (committed) new Notice('Templar settings restored to defaults.');
      },
      'Reset settings',
    ).open();
  }

  private async commitSetting(
    description: string,
    mutate: (draft: TemplarPlugin['settings']) => void,
    options: { refresh?: boolean } = {},
  ): Promise<boolean> {
    try {
      await this.plugin.updateSettings(mutate);
      if (options.refresh) this.plugin.refreshEverything();
      return true;
    } catch (error) {
      new Notice(`Templar could not save ${description}: ${error instanceof Error ? error.message : String(error)}`);
      this.render();
      return false;
    }
  }
}
