import {
  Modal,
  Setting,
  TFile,
} from 'obsidian';
import type TemplarPlugin from '../../main';
import type {
  ImageFrame,
  TemplarNoteStyle,
  TemplarTemplate,
  PaperPattern,
} from '../../types';
import {
  clone,
} from '../../utils/value';
import {
  applyFramePreset,
  renderPageOptionSettings,
  runButtonAction,
} from './shared';

/* The class is kept in its focused modal module; shared UI helpers live in ./shared. */
export class CurrentNoteInspectorModal extends Modal {
  private readonly original: TemplarNoteStyle;
  private readonly draft: TemplarNoteStyle;
  private readonly owner = `inspector-${Math.random().toString(36).slice(2)}`;
  private saved = false;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly file: TFile,
    style: TemplarNoteStyle,
  ) {
    super(plugin.app);
    this.original = clone(style);
    this.draft = clone(style);
  }

  public onOpen(): void {
    this.setTitle(`Customize ${this.file.basename}`);
    this.modalEl.addClass('templar-modal', 'templar-inspector-modal');
    this.contentEl.createEl('p', { text: 'Changes here affect only this note. Nothing is written until save changes.' });
    this.renderAppearance();
    this.renderTypography();
    this.renderHeadings();
    this.renderLayout();
    this.renderImages();
    this.renderPage();
    this.renderWatermark();
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const discard = actions.createEl('button', { text: 'Discard changes' });
    discard.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save changes' });
    save.addEventListener('click', () => void runButtonAction(save, async () => {
      await this.plugin.application.writeStyle(this.file, this.draft);
      this.saved = true;
      await this.plugin.preview.cancel(this.owner);
      this.plugin.refreshSidebars();
      this.plugin.updateStatusBar();
      this.close();
    }));
    this.updatePreview();
  }

  public onClose(): void {
    if (!this.saved) void this.plugin.preview.cancel(this.owner);
    this.contentEl.empty();
  }

  private section(title: string, key: keyof TemplarTemplate | 'page'): HTMLElement {
    const details = this.contentEl.createEl('details', { cls: 'templar-inspector-section' });
    details.open = title === 'Appearance';
    const summary = details.createEl('summary');
    summary.createSpan({ text: title });
    const reset = summary.createEl('button', { text: 'Reset section', attr: { 'aria-label': `Reset ${title}` } });
    reset.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const source = key === 'page' ? null : this.plugin.library.get(this.draft.sourceTemplateId ?? this.draft.id);
      const baseline = source ?? this.original;
      if (title === 'Appearance') {
        this.draft.paper = clone(baseline.paper);
        this.draft.typography.textColor = baseline.typography.textColor;
        this.draft.typography.mutedColor = baseline.typography.mutedColor;
        this.draft.blocks.highlightBackground = baseline.blocks.highlightBackground;
        this.draft.blocks.highlightTextColor = baseline.blocks.highlightTextColor;
        this.contentEl.empty();
        this.onOpen();
        return;
      }
      if (title === 'Typography') {
        this.draft.typography = clone(baseline.typography);
        this.draft.baseline = clone(baseline.baseline);
        this.contentEl.empty();
        this.onOpen();
        return;
      }
      const replacement = source
        ? clone(source[key as keyof TemplarTemplate])
        : clone(this.original[key as keyof TemplarNoteStyle]);
      (this.draft as unknown as Record<string, unknown>)[key] = replacement;
      this.contentEl.empty();
      this.onOpen();
    });
    return details.createDiv({ cls: 'templar-inspector-controls' });
  }

  private renderAppearance(): void {
    const section = this.section('Appearance', 'paper');
    new Setting(section).setName('Paper color').addColorPicker((picker) => picker.setValue(this.draft.paper.color).onChange((value) => { this.draft.paper.color = value; this.updatePreview(); }));
    new Setting(section).setName('Pattern').addDropdown((dropdown) => dropdown.addOptions({ blank: 'Blank', ruled: 'Ruled', ledger: 'Ledger', 'dot-grid': 'Dot grid', graph: 'Graph', 'cross-hatch': 'Cross hatch', diagonal: 'Diagonal', hex: 'Hex', scallop: 'Scallop' }).setValue(this.draft.paper.pattern).onChange((value) => { this.draft.paper.pattern = value as PaperPattern; this.updatePreview(); }));
    new Setting(section).setName('Pattern color').addColorPicker((picker) => picker.setValue(this.draft.paper.patternColor).onChange((value) => { this.draft.paper.patternColor = value; this.updatePreview(); }));
    new Setting(section).setName('Text color').addColorPicker((picker) => picker.setValue(this.draft.typography.textColor).onChange((value) => { this.draft.typography.textColor = value; this.updatePreview(); }));
    new Setting(section).setName('Highlight background').addColorPicker((picker) => picker.setValue(this.draft.blocks.highlightBackground).onChange((value) => { this.draft.blocks.highlightBackground = value; this.updatePreview(); }));
    new Setting(section).setName('Highlight text').addColorPicker((picker) => picker.setValue(this.draft.blocks.highlightTextColor).onChange((value) => { this.draft.blocks.highlightTextColor = value; this.updatePreview(); }));
  }

  private renderTypography(): void {
    const section = this.section('Typography', 'typography');
    new Setting(section).setName('Body font').addText((text) => text.setValue(this.draft.typography.bodyFont).onChange((value) => { this.draft.typography.bodyFont = value; this.updatePreview(); }));
    this.slider(section, 'Body size', this.draft.typography.bodySize, 8, 72, (value) => { this.draft.typography.bodySize = value; });
    this.slider(section, 'Body weight', this.draft.typography.bodyWeight, 100, 900, (value) => { this.draft.typography.bodyWeight = value; }, 100);
    this.slider(section, 'Line height (0 = automatic)', this.draft.typography.bodyLineHeight, 0, 120, (value) => { this.draft.typography.bodyLineHeight = value; });
    this.slider(section, 'Baseline unit', this.draft.baseline.unit, 12, 96, (value) => { this.draft.baseline.unit = value; });
  }

  private renderHeadings(): void {
    const section = this.section('Headings', 'headings');
    const originalSizes = clone(this.draft.headings);
    this.slider(section, 'Overall heading scale', 100, 60, 160, (value) => {
      for (const key of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const) {
        this.draft.headings[key].size = Math.round(originalSizes[key].size * value / 100);
      }
    });
    section.createEl('p', { text: 'Use the full template creator or raw editor for per-heading controls.' });
  }

  private renderLayout(): void {
    const section = this.section('Layout', 'layout');
    this.slider(section, 'Content width', this.draft.layout.maxWidth, 320, 2400, (value) => { this.draft.layout.maxWidth = value; }, 10);
    for (const [label, key, max] of [['Top padding', 'paddingTop', 400], ['Right padding', 'paddingRight', 400], ['Bottom padding', 'paddingBottom', 600], ['Left padding', 'paddingLeft', 400]] as const) {
      this.slider(section, label, this.draft.layout[key], 0, max, (value) => { this.draft.layout[key] = value; });
    }
    this.slider(section, 'Page radius', this.draft.layout.pageRadius, 0, 80, (value) => { this.draft.layout.pageRadius = value; });
    new Setting(section).setName('Page shadow').addText((text) => text.setValue(this.draft.layout.pageShadow).onChange((value) => { this.draft.layout.pageShadow = value; this.updatePreview(); }));
  }

  private renderImages(): void {
    const section = this.section('Images', 'images');
    new Setting(section).setName('Default frame').addDropdown((dropdown) => dropdown.addOptions({ none: 'None', thin: 'Thin', photo: 'Photo', polaroid: 'Polaroid', scrapbook: 'Scrapbook', rounded: 'Rounded', technical: 'Technical', dark: 'Dark', vintage: 'Vintage' }).setValue(this.draft.images.frame).onChange((value) => { this.draft.images.frame = value as ImageFrame; applyFramePreset(this.draft, this.draft.images.frame); this.updatePreview(); }));
    this.slider(section, 'Maximum width', this.draft.images.maxWidth, 10, 100, (value) => { this.draft.images.maxWidth = value; });
    this.slider(section, 'Top spacing', this.draft.images.topSpacing, 0, 180, (value) => { this.draft.images.topSpacing = value; });
    this.slider(section, 'Bottom spacing', this.draft.images.bottomSpacing, 0, 180, (value) => { this.draft.images.bottomSpacing = value; });
    this.slider(section, 'Sepia', this.draft.images.sepia, 0, 1, (value) => { this.draft.images.sepia = value; }, 0.05);
  }

  private renderPage(): void {
    const section = this.section('Page', 'page');
    renderPageOptionSettings(section, this.draft.page, () => this.updatePreview());
  }

  private renderWatermark(): void {
    const section = this.section('Watermark', 'watermark');
    new Setting(section).setName('Text').addText((text) => text.setValue(this.draft.watermark.text).onChange((value) => { this.draft.watermark.text = value; this.updatePreview(); }));
    this.slider(section, 'Opacity', this.draft.watermark.opacity, 0.05, 1, (value) => { this.draft.watermark.opacity = value; }, 0.05);
    this.slider(section, 'Size', this.draft.watermark.size, 24, 240, (value) => { this.draft.watermark.size = value; });
    this.slider(section, 'Rotation', this.draft.watermark.rotation, -45, 45, (value) => { this.draft.watermark.rotation = value; });
  }

  private slider(container: HTMLElement, name: string, value: number, min: number, max: number, update: (value: number) => void, step = 1): void {
    new Setting(container).setName(name).addSlider((slider) => slider.setLimits(min, max, step).setValue(value).onChange((next) => { update(next); this.updatePreview(); }));
  }

  private updatePreview(): void {
    const leaf = this.plugin.activeMarkdownLeaf();
    if (!leaf) return;
    this.plugin.preview.previewStyle(this.owner, leaf, this.file, this.draft);
  }
}
