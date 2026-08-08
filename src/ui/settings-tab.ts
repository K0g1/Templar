import { App, Notice, PluginSettingTab, Setting } from 'obsidian';
import { DEFAULT_TEMPLATE_ID, VIRTUAL_SELECTORS } from '../constants';
import type TemplarPlugin from '../main';
import { DEFAULT_SETTINGS } from '../templates/defaults';
import { clone } from '../utils/value';
import { ConfirmationModal } from './modals';
import { renderIssues } from './issues';
import { renderTemplatePreview } from './template-preview';

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
        toggle.setValue(this.plugin.settings.enableReadingView).onChange(async (value) => {
          this.plugin.settings.enableReadingView = value;
          await this.plugin.saveSettings();
          this.plugin.refreshEverything();
        }),
      );
    new Setting(containerEl)
      .setName('Style live preview')
      .setDesc('Render the same page style while editing Markdown.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.enableLivePreview).onChange(async (value) => {
          this.plugin.settings.enableLivePreview = value;
          await this.plugin.saveSettings();
          this.plugin.refreshEverything();
        }),
      );
    new Setting(containerEl)
      .setName('Hide templar metadata')
      .setDesc('Collapse the templar YAML block during ordinary editing. Use “edit raw style” to inspect it.')
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.hideStyleMetadata).onChange(async (value) => {
          this.plugin.settings.hideStyleMetadata = value;
          await this.plugin.saveSettings();
          this.plugin.refreshEverything();
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
          .onChange(async (value) => {
            this.plugin.settings.defaultTemplateId = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(containerEl).setName('Template library').setHeading();
    containerEl.createEl('p', {
      text: `${String(this.plugin.library.builtIns().length)} built-in and ${String(this.plugin.library.userTemplates().length)} custom Page Styles are installed. Applying a style copies its complete design into the note.`,
    });
    new Setting(containerEl)
      .setName('Open page styles')
      .setDesc('Preview, apply, customize, duplicate, export, and delete styles.')
      .addButton((button) =>
        button.setButtonText('Open library').onClick(() => void this.plugin.openStylesView()),
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

    new Setting(containerEl).setName('Typography and baseline').setHeading();
    new Setting(containerEl)
      .setName('Default vertical rhythm')
      .setDesc('Starting grid unit for new page styles. Existing notes keep their embedded value.')
      .addSlider((slider) =>
        slider
          .setLimits(16, 60, 1)
          .setValue(this.plugin.settings.defaultGridUnit)
          .onChange(async (value) => {
            this.plugin.settings.defaultGridUnit = value;
            await this.plugin.saveSettings();
          }),
      );
    new Setting(containerEl)
      .setName('Font calibration cache')
      .setDesc('Maximum measured font combinations retained in memory. The cache clears when the plugin unloads.')
      .addSlider((slider) =>
        slider
          .setLimits(16, 256, 8)
          .setValue(this.plugin.settings.fontCacheSize)
          .onChange(async (value) => {
            this.plugin.settings.fontCacheSize = value;
            await this.plugin.saveSettings();
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
      void renderTemplatePreview(preview, selected, this.plugin.fontMetrics);
    }

    new Setting(containerEl).setName('AI / LLM template builder').setHeading();
    containerEl.createEl('p', {
      text: 'Templar does not send notes to an AI service and requires no API key. The authoring skill is a portable instruction document you can paste into any capable model.',
    });
    new Setting(containerEl)
      .setName('Template authoring skill')
      .setDesc('Includes the v1 schema, selectors, safety rules, performance guidance, and a complete example.')
      .addButton((button) =>
        button.setButtonText('Copy instructions').setCta().onClick(() => void this.plugin.copyAuthoringKit()),
      )
      .addButton((button) =>
        button.setButtonText('Export to vault').onClick(() => void this.plugin.exportAuthoringKit()),
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
      .setDesc('Restores every option to its default value. Custom page styles in your library are kept; favorites are cleared.')
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
      'Every option returns to its default value. Custom page styles are kept, favorites are cleared.',
      async () => {
        const defaults = clone(DEFAULT_SETTINGS);
        defaults.userTemplates = this.plugin.settings.userTemplates;
        Object.assign(this.plugin.settings, defaults);
        await this.plugin.saveSettings();
        this.plugin.refreshEverything();
        this.render();
        new Notice('Templar settings restored to defaults.');
      },
      'Reset settings',
    ).open();
  }
}
