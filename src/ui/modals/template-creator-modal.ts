import {
  Modal,
  Notice,
  Setting,
  stringifyYaml,
} from 'obsidian';
import type TemplarPlugin from '../../main';
import {
  BUILT_IN_TEMPLATES,
} from '../../templates/builtins';
import {
  DEFAULT_TEMPLATE,
} from '../../templates/defaults';
import {
  DEFAULT_PAGE_OPTIONS,
} from '../../templates/defaults';
import {
  templateToExportObject,
} from '../../templates/note-format';
import {
  normalizeTemplate,
  normalizeTemplateFolder,
} from '../../templates/schema';
import {
  validateCompleteTemplate,
} from '../../templates/validation';
import type {
  BaselineMode,
  DividerStyle,
  HeadingTextTransform,
  ImageFloat,
  ImageFrame,
  ImageObjectFit,
  ListMarkerStyle,
  TemplarTemplate,
  PaperPattern,
} from '../../types';
import {
  writeTextToClipboard,
} from '../../utils/clipboard';
import {
  clone,
  slugify,
} from '../../utils/value';
import {
  renderIssues,
} from '../issues';
import {
  ConfirmationModal,
} from './confirmation-modal';
import {
  applyFramePreset,
  runButtonAction,
} from './shared';
import { renderTemplatePreview } from '../template-preview';

/* The class is kept in its focused modal module; shared UI helpers live in ./shared. */
export class TemplateCreatorModal extends Modal {
  private draft: TemplarTemplate;
  private readonly originalId: string | null;
  private readonly sourceBuiltInId: string | null;
  private editorEl!: HTMLElement;
  private previewEl!: HTMLElement;
  private issuesEl!: HTMLElement;
  private generatedOutputEl: HTMLTextAreaElement | null = null;
  private mode: 'simple' | 'detailed' | 'advanced' = 'simple';
  private previewPage = clone(DEFAULT_PAGE_OPTIONS);
  private previewVersion = 0;

  public constructor(
    private readonly plugin: TemplarPlugin,
    template?: TemplarTemplate,
  ) {
    super(plugin.app);
    this.draft = clone(template ?? DEFAULT_TEMPLATE);
    this.originalId = template && !template.builtIn ? template.id : null;
    this.sourceBuiltInId = template && template.builtIn ? template.id : null;
    this.draft.builtIn = false;
    if (!template) {
      this.draft.id = `custom-style-${String(Date.now())}`;
      this.draft.name = 'My Page Style';
      this.draft.baseline.unit = plugin.settings.defaultGridUnit;
    }
  }

  public onOpen(): void {
    this.setTitle('Template creator');
    this.modalEl.addClass('templar-modal', 'templar-creator-modal');
    const tabs = this.contentEl.createDiv({ cls: 'templar-tabs' });
    const simple = tabs.createEl('button', { text: 'Simple mode' });
    const detailed = tabs.createEl('button', { text: 'Detailed mode' });
    const advanced = tabs.createEl('button', { text: 'Advanced mode' });
    simple.addEventListener('click', () => {
      this.mode = 'simple';
      this.renderEditor();
    });
    detailed.addEventListener('click', () => {
      this.mode = 'detailed';
      this.renderEditor();
    });
    advanced.addEventListener('click', () => {
      this.mode = 'advanced';
      this.renderEditor();
    });

    const workspace = this.contentEl.createDiv({ cls: 'templar-creator-workspace' });
    this.editorEl = workspace.createDiv({ cls: 'templar-creator-editor' });
    const previewColumn = workspace.createDiv({ cls: 'templar-creator-preview' });
    previewColumn.createDiv({ cls: 'templar-section-label', text: 'Live preview' });
    const previewMode = previewColumn.createEl('button', {
      cls: 'templar-preview-mode',
      text: 'Preview paged',
    });
    previewMode.addEventListener('click', () => {
      this.previewPage.mode = this.previewPage.mode === 'paged' ? 'pageless' : 'paged';
      previewMode.setText(
        this.previewPage.mode === 'paged' ? 'Preview pageless' : 'Preview paged',
      );
      void this.updatePreview();
    });
    this.previewEl = previewColumn.createDiv({ cls: 'templar-preview-container' });
    this.issuesEl = previewColumn.createDiv();

    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    if (this.sourceBuiltInId) {
      const resetButton = actions.createEl('button', {
        cls: 'mod-warning',
        text: 'Reset to default',
      });
      resetButton.addEventListener('click', () => void this.resetToDefault());
    }
    const exportButton = actions.createEl('button', { text: 'Copy YAML' });
    exportButton.addEventListener('click', () =>
      void runButtonAction(exportButton, async () => this.copyYaml()),
    );
    const saveButton = actions.createEl('button', {
      cls: 'mod-cta',
      text: 'Save to library',
    });
    saveButton.addEventListener('click', () => void runButtonAction(saveButton, async () => this.save()));
    this.renderEditor();
  }

  public onClose(): void {
    this.contentEl.empty();
  }

  private renderEditor(): void {
    this.editorEl.empty();
    this.generatedOutputEl = null;
    if (this.mode === 'advanced') {
      this.renderAdvancedEditor();
    } else if (this.mode === 'detailed') {
      this.renderDetailedEditor();
    } else {
      this.renderSimpleEditor();
    }
    void this.updatePreview();
  }

  private renderDetailedEditor(): void {
    this.heading('Identity and metadata');
    this.textSetting('Name', 'Shown in the Page Style library.', this.draft.name, (value) => {
      this.draft.name = value;
      if (!this.originalId) {
        this.draft.id = slugify(value);
      }
    });
    this.textSetting('Description', 'Explain the intended aesthetic.', this.draft.metadata.description, (value) => {
      this.draft.metadata.description = value;
    });
    this.folderSetting();
    this.textSetting('Author', 'Stored in exported template metadata.', this.draft.metadata.author, (value) => {
      this.draft.metadata.author = value;
    });
    this.textSetting('Tags', 'Comma-separated library tags.', this.draft.metadata.tags.join(', '), (value) => {
      this.draft.metadata.tags = value.split(',').map((tag) => tag.trim()).filter(Boolean);
    });

    this.heading('Paper and pattern');
    this.colorSetting('Paper background', this.draft.paper.color, (value) => {
      this.draft.paper.color = value;
    });
    new Setting(this.editorEl).setName('Pattern').addDropdown((dropdown) =>
      dropdown
        .addOptions({
          blank: 'Blank',
          ruled: 'Ruled',
          ledger: 'Ledger',
          'dot-grid': 'Dot grid',
          graph: 'Graph',
          'cross-hatch': 'Cross hatch',
          diagonal: 'Diagonal',
          hex: 'Hex',
          scallop: 'Scallop',
        })
        .setValue(this.draft.paper.pattern)
        .onChange((value) => {
          this.draft.paper.pattern = value as PaperPattern;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Minor pattern color', this.draft.paper.patternColor, (value) => {
      this.draft.paper.patternColor = value;
    });
    this.colorSetting('Major graph color', this.draft.paper.majorPatternColor, (value) => {
      this.draft.paper.majorPatternColor = value;
    });
    this.sliderSetting('Pattern opacity', this.draft.paper.patternOpacity, 0, 1, 0.05, (value) => {
      this.draft.paper.patternOpacity = value;
    });
    this.sliderSetting('Pattern scale', this.draft.paper.patternScale, 0.25, 4, 0.05, (value) => {
      this.draft.paper.patternScale = value;
    });
    this.sliderSetting('Dot radius', this.draft.paper.dotRadius, 0.5, 6, 0.5, (value) => {
      this.draft.paper.dotRadius = value;
    });
    this.sliderSetting('Graph major interval', this.draft.paper.graphMajorInterval, 2, 10, 1, (value) => {
      this.draft.paper.graphMajorInterval = value;
    });
    this.toggleSetting('Margin line', this.draft.paper.marginLine, (value) => {
      this.draft.paper.marginLine = value;
    });
    this.colorSetting('Margin color', this.draft.paper.marginColor, (value) => {
      this.draft.paper.marginColor = value;
    });
    this.sliderSetting('Margin offset', this.draft.paper.marginOffset, 0, 400, 2, (value) => {
      this.draft.paper.marginOffset = value;
    });

    this.heading('Body typography and rhythm');
    this.textSetting('Body font', 'Use a complete fallback stack.', this.draft.typography.bodyFont, (value) => {
      this.draft.typography.bodyFont = value;
    });
    this.sliderSetting('Body size', this.draft.typography.bodySize, 8, 48, 1, (value) => {
      this.draft.typography.bodySize = value;
    });
    this.sliderSetting('Body weight', this.draft.typography.bodyWeight, 100, 900, 50, (value) => {
      this.draft.typography.bodyWeight = value;
    });
    this.colorSetting('Text color', this.draft.typography.textColor, (value) => {
      this.draft.typography.textColor = value;
    });
    this.colorSetting('Muted text color', this.draft.typography.mutedColor, (value) => {
      this.draft.typography.mutedColor = value;
    });
    this.sliderSetting('Body line height', this.draft.typography.bodyLineHeight, 0, 120, 1, (value) => {
      this.draft.typography.bodyLineHeight = value;
    }).setDesc('0 = automatic rhythm.');
    this.sliderSetting('First line indent', this.draft.typography.firstLineIndent, 0, 120, 2, (value) => {
      this.draft.typography.firstLineIndent = value;
    }).setDesc('Reading view only.');
    this.toggleSetting('Drop cap', this.draft.typography.dropCap, (value) => {
      this.draft.typography.dropCap = value;
    });
    this.sliderSetting('Vertical rhythm', this.draft.baseline.unit, 12, 96, 1, (value) => {
      this.draft.baseline.unit = value;
    });
    new Setting(this.editorEl).setName('Grid mode').addDropdown((dropdown) =>
      dropdown
        .addOptions({ strict: 'Strict', balanced: 'Balanced', free: 'Free' })
        .setValue(this.draft.baseline.mode)
        .onChange((value) => {
          this.draft.baseline.mode = value as BaselineMode;
          this.draft.baseline.enabled = value !== 'free';
          void this.updatePreview();
        }),
    );
    this.toggleSetting('Snap images to rhythm', this.draft.baseline.snapImages, (value) => {
      this.draft.baseline.snapImages = value;
    });

    this.heading('Heading typography');
    this.headingLevelSettings('h1', 'Heading 1');
    this.headingLevelSettings('h2', 'Heading 2');
    this.headingLevelSettings('h3', 'Heading 3');
    this.headingLevelSettings('h4', 'Heading 4');
    this.headingLevelSettings('h5', 'Heading 5');
    this.headingLevelSettings('h6', 'Heading 6');

    this.heading('Lists');
    new Setting(this.editorEl).setName('Bullet style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ disc: 'Disc', circle: 'Circle', square: 'Square', none: 'None' })
        .setValue(this.draft.lists.markerStyle)
        .onChange((value) => {
          this.draft.lists.markerStyle = value as ListMarkerStyle;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Marker color', this.draft.lists.markerColor, (value) => {
      this.draft.lists.markerColor = value;
    });
    this.toggleSetting('Indent guides', this.draft.lists.indentGuides, (value) => {
      this.draft.lists.indentGuides = value;
    });
    this.colorSetting('Indent guide color', this.draft.lists.indentGuideColor, (value) => {
      this.draft.lists.indentGuideColor = value;
    });
    this.sliderSetting('Nested list indent', this.draft.lists.nestedIndent, 0, 120, 2, (value) => {
      this.draft.lists.nestedIndent = value;
    }).setDesc('0 = Obsidian default. Reading view only.');

    this.heading('Page geometry');
    this.sliderSetting('Maximum width', this.draft.layout.maxWidth, 320, 1800, 10, (value) => {
      this.draft.layout.maxWidth = value;
    });
    this.sliderSetting('Top padding', this.draft.layout.paddingTop, 0, 200, 2, (value) => {
      this.draft.layout.paddingTop = value;
    });
    this.sliderSetting('Right padding', this.draft.layout.paddingRight, 0, 180, 2, (value) => {
      this.draft.layout.paddingRight = value;
    });
    this.sliderSetting('Bottom padding', this.draft.layout.paddingBottom, 0, 300, 2, (value) => {
      this.draft.layout.paddingBottom = value;
    });
    this.sliderSetting('Left padding', this.draft.layout.paddingLeft, 0, 180, 2, (value) => {
      this.draft.layout.paddingLeft = value;
    });
    this.sliderSetting('Page corner radius', this.draft.layout.pageRadius, 0, 80, 1, (value) => {
      this.draft.layout.pageRadius = value;
    });
    this.textSetting('Page shadow', 'A self-contained CSS box-shadow value.', this.draft.layout.pageShadow, (value) => {
      this.draft.layout.pageShadow = value;
    });

    this.heading('Images');
    new Setting(this.editorEl).setName('Frame style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', thin: 'Thin', photo: 'Photo', polaroid: 'Polaroid', scrapbook: 'Scrapbook', rounded: 'Rounded', technical: 'Technical', dark: 'Dark', vintage: 'Vintage' })
        .setValue(this.draft.images.frame)
        .onChange((value) => {
          this.draft.images.frame = value as ImageFrame;
          void this.updatePreview();
        }),
    );
    this.sliderSetting('Border width', this.draft.images.borderWidth, 0, 40, 1, (value) => {
      this.draft.images.borderWidth = value;
    });
    this.sliderSetting('Bottom border width', this.draft.images.bottomBorderWidth, 0, 80, 1, (value) => {
      this.draft.images.bottomBorderWidth = value;
    });
    this.colorSetting('Border color', this.draft.images.borderColor, (value) => {
      this.draft.images.borderColor = value;
    });
    this.sliderSetting('Corner radius', this.draft.images.cornerRadius, 0, 60, 1, (value) => {
      this.draft.images.cornerRadius = value;
    });
    this.sliderSetting('Rotation', this.draft.images.rotation, -15, 15, 0.5, (value) => {
      this.draft.images.rotation = value;
    });
    this.textSetting('Image shadow', 'A self-contained CSS box-shadow value.', this.draft.images.shadow, (value) => {
      this.draft.images.shadow = value;
    });
    this.sliderSetting('Maximum width', this.draft.images.maxWidth, 10, 100, 1, (value) => {
      this.draft.images.maxWidth = value;
    });
    this.sliderSetting('Top spacing', this.draft.images.topSpacing, 0, 120, 1, (value) => {
      this.draft.images.topSpacing = value;
    });
    this.sliderSetting('Bottom spacing', this.draft.images.bottomSpacing, 0, 120, 1, (value) => {
      this.draft.images.bottomSpacing = value;
    });
    this.sliderSetting('Opacity', this.draft.images.opacity, 0, 1, 0.05, (value) => {
      this.draft.images.opacity = value;
    });
    this.sliderSetting('Sepia', this.draft.images.sepia, 0, 1, 0.05, (value) => {
      this.draft.images.sepia = value;
    });
    this.sliderSetting('Grayscale', this.draft.images.grayscale, 0, 1, 0.05, (value) => {
      this.draft.images.grayscale = value;
    });
    this.sliderSetting('Saturation', this.draft.images.saturation, 0, 4, 0.05, (value) => {
      this.draft.images.saturation = value;
    });
    this.sliderSetting('Contrast', this.draft.images.contrast, 0, 4, 0.05, (value) => {
      this.draft.images.contrast = value;
    });
    new Setting(this.editorEl).setName('Float').addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', left: 'Left', right: 'Right' })
        .setValue(this.draft.images.float)
        .onChange((value) => {
          this.draft.images.float = value as ImageFloat;
          void this.updatePreview();
        }),
    );
    new Setting(this.editorEl).setName('Object fit').addDropdown((dropdown) =>
      dropdown
        .addOptions({ contain: 'Contain', cover: 'Cover', fill: 'Fill', 'scale-down': 'Scale down' })
        .setValue(this.draft.images.objectFit)
        .onChange((value) => {
          this.draft.images.objectFit = value as ImageObjectFit;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Duotone', this.draft.images.duotone, (value) => {
      this.draft.images.duotone = value;
    });

    this.heading('Links, quotes, code, tables, lists, and callouts');
    this.colorSetting('Link color', this.draft.blocks.linkColor, (value) => {
      this.draft.blocks.linkColor = value;
    });
    this.colorSetting('Highlight background', this.draft.blocks.highlightBackground, (value) => {
      this.draft.blocks.highlightBackground = value;
    });
    this.colorSetting('Highlighted text', this.draft.blocks.highlightTextColor, (value) => {
      this.draft.blocks.highlightTextColor = value;
    });
    this.colorSetting('Quote accent', this.draft.blocks.quoteAccent, (value) => {
      this.draft.blocks.quoteAccent = value;
    });
    this.colorSetting('Quote background', this.draft.blocks.quoteBackground, (value) => {
      this.draft.blocks.quoteBackground = value;
    });
    this.colorSetting('Quote text', this.draft.blocks.quoteTextColor, (value) => {
      this.draft.blocks.quoteTextColor = value;
    });
    this.colorSetting('Code background', this.draft.blocks.codeBackground, (value) => {
      this.draft.blocks.codeBackground = value;
    });
    this.colorSetting('Code text', this.draft.blocks.codeTextColor, (value) => {
      this.draft.blocks.codeTextColor = value;
    });
    this.textSetting('Code font', 'Use a complete monospace fallback stack.', this.draft.blocks.codeFont, (value) => {
      this.draft.blocks.codeFont = value;
    });
    this.sliderSetting('Code size', this.draft.blocks.codeSize, 8, 48, 1, (value) => {
      this.draft.blocks.codeSize = value;
    });
    this.colorSetting('Table borders', this.draft.blocks.tableBorder, (value) => {
      this.draft.blocks.tableBorder = value;
    });
    this.colorSetting('Table header background', this.draft.blocks.tableHeaderBackground, (value) => {
      this.draft.blocks.tableHeaderBackground = value;
    });
    this.sliderSetting('Table border width', this.draft.blocks.tableBorderWidth, 0, 12, 1, (value) => {
      this.draft.blocks.tableBorderWidth = value;
    });
    this.sliderSetting('Table font size', this.draft.blocks.tableFontSize, 8, 48, 1, (value) => {
      this.draft.blocks.tableFontSize = value;
    });
    this.colorSetting('Table text', this.draft.blocks.tableTextColor, (value) => {
      this.draft.blocks.tableTextColor = value;
    });
    this.colorSetting('Table header text', this.draft.blocks.tableHeaderTextColor, (value) => {
      this.draft.blocks.tableHeaderTextColor = value;
    });
    this.sliderSetting('Table padding', this.draft.blocks.tablePadding, 0, 40, 1, (value) => {
      this.draft.blocks.tablePadding = value;
    });
    this.toggleSetting('Striped table rows', this.draft.blocks.tableStriped, (value) => {
      this.draft.blocks.tableStriped = value;
    });
    this.colorSetting('Table stripe color', this.draft.blocks.tableStripeColor, (value) => {
      this.draft.blocks.tableStripeColor = value;
    });
    this.colorSetting('Checkbox accent', this.draft.blocks.checkboxAccent, (value) => {
      this.draft.blocks.checkboxAccent = value;
    });
    this.colorSetting('Divider color', this.draft.blocks.dividerColor, (value) => {
      this.draft.blocks.dividerColor = value;
    });
    this.sliderSetting('Divider width', this.draft.blocks.dividerWidth, 1, 20, 1, (value) => {
      this.draft.blocks.dividerWidth = value;
    });
    new Setting(this.editorEl).setName('Divider style').addDropdown((dropdown) =>
      dropdown
        .addOptions({ solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted', double: 'Double', fade: 'Fade' })
        .setValue(this.draft.blocks.dividerStyle)
        .onChange((value) => {
          this.draft.blocks.dividerStyle = value as DividerStyle;
          void this.updatePreview();
        }),
    );
    this.colorSetting('Callout accent', this.draft.blocks.calloutAccent, (value) => {
      this.draft.blocks.calloutAccent = value;
    });
    this.colorSetting('Callout background', this.draft.blocks.calloutBackground, (value) => {
      this.draft.blocks.calloutBackground = value;
    });
    this.colorSetting('Callout text', this.draft.blocks.calloutTextColor, (value) => {
      this.draft.blocks.calloutTextColor = value;
    });
    this.colorSetting('Callout title', this.draft.blocks.calloutTitleColor, (value) => {
      this.draft.blocks.calloutTitleColor = value;
    });
    this.colorSetting('Callout icon', this.draft.blocks.calloutIconColor, (value) => {
      this.draft.blocks.calloutIconColor = value;
    });
    this.sliderSetting('Callout border width', this.draft.blocks.calloutBorderWidth, 0, 12, 1, (value) => {
      this.draft.blocks.calloutBorderWidth = value;
    });
    this.sliderSetting('Callout corner radius', this.draft.blocks.calloutRadius, 0, 60, 1, (value) => {
      this.draft.blocks.calloutRadius = value;
    });
    this.colorSetting('Embed background', this.draft.blocks.embedBackground, (value) => {
      this.draft.blocks.embedBackground = value;
    });
    this.colorSetting('Embed accent', this.draft.blocks.embedAccent, (value) => {
      this.draft.blocks.embedAccent = value;
    });
    this.sliderSetting('Embed corner radius', this.draft.blocks.embedRadius, 0, 60, 1, (value) => {
      this.draft.blocks.embedRadius = value;
    });

    this.heading('Watermark');
    this.textSetting('Watermark text', 'Leave empty to hide the watermark.', this.draft.watermark.text, (value) => {
      this.draft.watermark.text = value;
    });
    this.colorSetting('Watermark color', this.draft.watermark.color, (value) => {
      this.draft.watermark.color = value;
    });
    this.sliderSetting('Watermark size', this.draft.watermark.size, 24, 240, 2, (value) => {
      this.draft.watermark.size = value;
    });
    this.sliderSetting('Watermark rotation', this.draft.watermark.rotation, -45, 45, 1, (value) => {
      this.draft.watermark.rotation = value;
    });
    this.sliderSetting('Watermark opacity', this.draft.watermark.opacity, 0.05, 1, 0.05, (value) => {
      this.draft.watermark.opacity = value;
    });
  }

  private headingLevelSettings(
    level: 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6',
    label: string,
  ): void {
    const heading = this.draft.headings[level];
    this.textSetting(`${label} font`, 'Use a complete fallback stack.', heading.font, (value) => {
      this.draft.headings[level].font = value;
    });
    this.sliderSetting(`${label} size`, heading.size, 8, 144, 1, (value) => {
      this.draft.headings[level].size = value;
    });
    this.sliderSetting(`${label} weight`, heading.weight, 100, 900, 50, (value) => {
      this.draft.headings[level].weight = value;
    });
    this.colorSetting(`${label} color`, heading.color, (value) => {
      this.draft.headings[level].color = value;
    });
    new Setting(this.editorEl).setName(`${label} decoration`).addDropdown((dropdown) =>
      dropdown
        .addOptions({ none: 'None', underline: 'Underline', rule: 'Rule', highlight: 'Highlight' })
        .setValue(heading.decoration)
        .onChange((value) => {
          this.draft.headings[level].decoration = value as typeof heading.decoration;
          void this.updatePreview();
        }),
    );
    this.sliderSetting(`${label} letter spacing`, heading.letterSpacing, 0, 10, 0.5, (value) => {
      this.draft.headings[level].letterSpacing = value;
    });
    new Setting(this.editorEl).setName(`${label} text transform`).addDropdown((dropdown) =>
      dropdown
        .addOptions({
          none: 'None',
          uppercase: 'UPPERCASE',
          lowercase: 'lowercase',
          capitalize: 'Capitalize',
        })
        .setValue(heading.textTransform)
        .onChange((value) => {
          this.draft.headings[level].textTransform = value as HeadingTextTransform;
          void this.updatePreview();
        }),
    );
  }

  private toggleSetting(
    name: string,
    value: boolean,
    update: (value: boolean) => void,
  ): void {
    new Setting(this.editorEl).setName(name).addToggle((toggle) =>
      toggle.setValue(value).onChange((next) => {
        update(next);
        void this.updatePreview();
      }),
    );
  }

  private renderSimpleEditor(): void {
    this.heading('Identity');
    this.textSetting('Name', 'Shown in the Page Style library.', this.draft.name, (value) => {
      this.draft.name = value;
      if (!this.originalId) {
        this.draft.id = slugify(value);
      }
    });
    this.textSetting(
      'Description',
      'A short explanation of the visual design.',
      this.draft.metadata.description,
      (value) => {
        this.draft.metadata.description = value;
      },
    );
    this.folderSetting();

    this.heading('Paper');
    this.colorSetting('Background', this.draft.paper.color, (value) => {
      this.draft.paper.color = value;
    });
    new Setting(this.editorEl)
      .setName('Pattern')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            blank: 'Blank',
            ruled: 'Ruled',
            ledger: 'Ledger',
            'dot-grid': 'Dot grid',
            graph: 'Graph',
            'cross-hatch': 'Cross hatch',
            diagonal: 'Diagonal',
            hex: 'Hex',
            scallop: 'Scallop',
          })
          .setValue(this.draft.paper.pattern)
          .onChange((value) => {
            this.draft.paper.pattern = value as PaperPattern;
            void this.updatePreview();
          }),
      );
    this.colorSetting('Pattern color', this.draft.paper.patternColor, (value) => {
      this.draft.paper.patternColor = value;
    });
    new Setting(this.editorEl)
      .setName('Margin line')
      .addToggle((toggle) =>
        toggle.setValue(this.draft.paper.marginLine).onChange((value) => {
          this.draft.paper.marginLine = value;
          void this.updatePreview();
        }),
      );

    this.heading('Typography and baseline');
    this.textSetting('Body font', 'Include fallback fonts.', this.draft.typography.bodyFont, (value) => {
      this.draft.typography.bodyFont = value;
    });
    this.sliderSetting('Font size', this.draft.typography.bodySize, 10, 40, 1, (value) => {
      this.draft.typography.bodySize = value;
    });
    this.sliderSetting('Vertical rhythm', this.draft.baseline.unit, 16, 60, 1, (value) => {
      this.draft.baseline.unit = value;
    });
    new Setting(this.editorEl)
      .setName('Grid alignment')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ strict: 'Strict', balanced: 'Balanced', free: 'Free' })
          .setValue(this.draft.baseline.mode)
          .onChange((value) => {
            this.draft.baseline.mode = value as BaselineMode;
            this.draft.baseline.enabled = value !== 'free';
            void this.updatePreview();
          }),
      );
    this.colorSetting('Text color', this.draft.typography.textColor, (value) => {
      this.draft.typography.textColor = value;
    });

    this.heading('Headings');
    this.sliderSetting('H1 size', this.draft.headings.h1.size, 20, 80, 1, (value) => {
      this.draft.headings.h1.size = value;
    });
    this.colorSetting('H1 color', this.draft.headings.h1.color, (value) => {
      this.draft.headings.h1.color = value;
    });

    this.heading('Layout');
    this.sliderSetting('Page width', this.draft.layout.maxWidth, 480, 1400, 20, (value) => {
      this.draft.layout.maxWidth = value;
    });
    this.sliderSetting('Left padding', this.draft.layout.paddingLeft, 0, 180, 4, (value) => {
      this.draft.layout.paddingLeft = value;
    });
    this.sliderSetting('Right padding', this.draft.layout.paddingRight, 0, 180, 4, (value) => {
      this.draft.layout.paddingRight = value;
    });

    this.heading('Images');
    new Setting(this.editorEl)
      .setName('Frame')
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            none: 'None',
            thin: 'Thin border',
            photo: 'Photograph',
            polaroid: 'Polaroid',
            scrapbook: 'Scrapbook',
            rounded: 'Rounded',
            technical: 'Technical',
            dark: 'Dark frame',
            vintage: 'Vintage',
          })
          .setValue(this.draft.images.frame)
          .onChange((value) => {
            this.draft.images.frame = value as ImageFrame;
            applyFramePreset(this.draft, this.draft.images.frame);
            void this.updatePreview();
          }),
      );
    this.sliderSetting('Rotation', this.draft.images.rotation, -8, 8, 0.5, (value) => {
      this.draft.images.rotation = value;
    });
    this.sliderSetting('Corner radius', this.draft.images.cornerRadius, 0, 40, 1, (value) => {
      this.draft.images.cornerRadius = value;
    });

    this.heading('Blocks');
    this.colorSetting('Link color', this.draft.blocks.linkColor, (value) => {
      this.draft.blocks.linkColor = value;
    });
    this.colorSetting('Quote accent', this.draft.blocks.quoteAccent, (value) => {
      this.draft.blocks.quoteAccent = value;
    });
    this.colorSetting('Callout accent', this.draft.blocks.calloutAccent, (value) => {
      this.draft.blocks.calloutAccent = value;
    });
    this.colorSetting('Checkbox accent', this.draft.blocks.checkboxAccent, (value) => {
      this.draft.blocks.checkboxAccent = value;
    });
    this.colorSetting(
      'Highlight background',
      this.draft.blocks.highlightBackground,
      (value) => {
        this.draft.blocks.highlightBackground = value;
      },
    );
    this.colorSetting(
      'Highlighted text',
      this.draft.blocks.highlightTextColor,
      (value) => {
        this.draft.blocks.highlightTextColor = value;
      },
    );
  }

  private renderAdvancedEditor(): void {
    this.heading('Library');
    this.folderSetting();
    this.heading('Advanced CSS');
    this.editorEl.createEl('p', {
      text: 'Every selector must begin with .page or .page-content. Imported URLs and global Obsidian selectors are rejected.',
    });
    const css = this.editorEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: { rows: '20' },
    });
    css.value = this.draft.css;
    css.addEventListener('input', () => {
      this.draft.css = css.value;
      void this.updatePreview();
    });
    this.heading('Generated template');
    this.generatedOutputEl = this.editorEl.createEl('textarea', {
      cls: 'templar-code-input',
      attr: { rows: '18', readonly: 'true' },
    });
    this.generatedOutputEl.value = stringifyYaml(templateToExportObject(this.draft));
  }

  private heading(text: string): void {
    new Setting(this.editorEl).setName(text).setHeading();
  }

  private folderSetting(): void {
    const listId = `templar-template-folders-${String(Date.now())}`;
    const setting = new Setting(this.editorEl)
      .setName('Folder')
      .setDesc('Organize this style in the library or enter a new folder name.');
    setting.addText((text) => {
      text.inputEl.setAttribute('list', listId);
      text.inputEl.setAttribute('placeholder', 'Unfiled');
      text.setValue(this.draft.metadata.folder).onChange((next) => {
        this.draft.metadata.folder = next;
        void this.updatePreview();
      });
      text.inputEl.addEventListener('blur', () => {
        const normalized = normalizeTemplateFolder(text.inputEl.value);
        text.setValue(normalized);
        this.draft.metadata.folder = normalized;
      });
    });
    const folders = new Set(this.plugin.library.folders());
    folders.add(normalizeTemplateFolder(this.draft.metadata.folder));
    const dataList = this.editorEl.createEl('datalist', { attr: { id: listId } });
    for (const folder of folders) {
      dataList.createEl('option', { attr: { value: folder } });
    }
  }

  private textSetting(
    name: string,
    description: string,
    value: string,
    update: (value: string) => void,
  ): void {
    new Setting(this.editorEl)
      .setName(name)
      .setDesc(description)
      .addText((text) =>
        text.setValue(value).onChange((next) => {
          update(next);
          void this.updatePreview();
        }),
      );
  }

  private colorSetting(name: string, value: string, update: (value: string) => void): void {
    const setting = new Setting(this.editorEl).setName(name);
    let textInput: HTMLInputElement | null = null;
    setting.addText((text) => {
      textInput = text.inputEl;
      text.setValue(value).onChange((next) => {
        update(next);
        void this.updatePreview();
      });
    });
    if (/^#[0-9a-f]{6}$/i.test(value)) {
      setting.addColorPicker((picker) =>
        picker.setValue(value).onChange((next) => {
          if (textInput) {
            textInput.value = next;
          }
          update(next);
          void this.updatePreview();
        }),
      );
    }
  }

  private sliderSetting(
    name: string,
    value: number,
    minimum: number,
    maximum: number,
    step: number,
    update: (value: number) => void,
  ): Setting {
    const setting = new Setting(this.editorEl)
      .setName(name)
      .setDesc(String(value))
      .addSlider((slider) =>
        slider
          .setLimits(minimum, maximum, step)
          .setValue(value)
          .onChange((next) => {
            update(next);
            void this.updatePreview();
          }),
      );
    return setting;
  }

  private async updatePreview(): Promise<void> {
    const version = ++this.previewVersion;
    const normalized = normalizeTemplate(this.draft);
    normalized.id = this.originalId ?? slugify(this.draft.name);
    normalized.name = this.draft.name;
    normalized.metadata = {
      ...clone(this.draft.metadata),
      folder: normalizeTemplateFolder(this.draft.metadata.folder),
    };
    normalized.css = this.draft.css;
    this.draft = normalized;
    const issues = validateCompleteTemplate(this.draft);
    renderIssues(this.issuesEl, issues);
    if (this.generatedOutputEl) {
      this.generatedOutputEl.value = stringifyYaml(templateToExportObject(this.draft));
    }
    const staging = this.previewEl.ownerDocument.createElement('div');
    await renderTemplatePreview(
      staging,
      this.draft,
      this.plugin.fontMetrics,
      this.previewPage,
    );
    if (version !== this.previewVersion) {
      return;
    }
    this.previewEl.empty();
    this.previewEl.append(...Array.from(staging.childNodes));
  }

  private async copyYaml(): Promise<void> {
    await writeTextToClipboard(
      stringifyYaml(templateToExportObject(this.draft)),
      this.contentEl.ownerDocument,
    );
    new Notice('Template YAML copied.');
  }

  private async resetToDefault(): Promise<void> {
    if (!this.sourceBuiltInId) {
      return;
    }
    const pristine = BUILT_IN_TEMPLATES.find(
      (template) => template.id === this.sourceBuiltInId,
    );
    if (!pristine) {
      new Notice('The built-in style is no longer available.');
      return;
    }
    const overrides = this.plugin.library
      .userTemplates()
      .filter(
        (template) =>
          template.id === `${this.sourceBuiltInId}-custom` ||
          template.id.startsWith(`${this.sourceBuiltInId}-custom-`),
      );
    const description = overrides.length > 0
      ? `The draft returns to the original “${pristine.name}” definition. This also removes ${overrides.map((template) => `“${template.name}”`).join(', ')} from your custom styles.`
      : `The draft returns to the original “${pristine.name}” definition. Any unsaved changes are discarded.`;
    new ConfirmationModal(
      this.plugin,
      `Reset “${pristine.name}” to its default?`,
      description,
      async () => {
        for (const override of overrides) {
          await this.plugin.library.remove(override.id);
        }
        this.draft = clone(pristine);
        this.draft.builtIn = false;
        this.plugin.refreshSidebars();
        this.renderEditor();
        new Notice(`“${pristine.name}” restored to its default.`);
      },
      'Reset to default',
    ).open();
  }

  private async save(): Promise<void> {
    const issues = validateCompleteTemplate(this.draft);
    renderIssues(this.issuesEl, issues);
    if (issues.some((issue) => issue.severity === 'error')) {
      new Notice('Fix the template problems before saving.');
      return;
    }
    const saved = this.originalId
      ? await this.plugin.library.save(this.draft)
      : await this.plugin.library.saveAsNew(this.draft);
    this.plugin.refreshSidebars();
    new Notice(`Saved “${saved.name}”.`);
    this.close();
  }
}
