import {
  Modal,
  Notice,
  Setting,
  TFile,
  getAllTags,
} from 'obsidian';
import type TemplarPlugin from '../../main';
import {
  pageFlowOptions,
  ruleMatches,
} from '../../services/style-rules';
import {
  DEFAULT_PAGE_OPTIONS,
} from '../../templates/defaults';
import type {
  StyleRule,
  StyleRuleCondition,
} from '../../types';
import {
  clone,
} from '../../utils/value';
import {
  ConfirmationModal,
} from './confirmation-modal';
import {
  runButtonAction,
} from './shared';
import { runUserAction } from '../async-actions';

/* The class is kept in its focused modal module; shared UI helpers live in ./shared. */
export class StyleRulesModal extends Modal {
  public constructor(private readonly plugin: TemplarPlugin) { super(plugin.app); }

  public onOpen(): void {
    this.setTitle('Style rules');
    this.modalEl.addClass('templar-modal', 'templar-rules-modal');
    this.render();
  }

  private render(): void {
    this.contentEl.empty();
    this.contentEl.createEl('p', { text: 'Rules apply only to unstyled notes. When multiple rules match, the first matching rule is used.' });
    const add = this.contentEl.createEl('button', { cls: 'mod-cta', text: 'Add rule' });
    add.addEventListener('click', () => new StyleRuleEditorModal(this.plugin, null, () => this.render()).open());
    const list = this.contentEl.createDiv({ cls: 'templar-rules-list' });
    this.plugin.settings.styleRules.forEach((rule, index) => {
      const row = list.createDiv({ cls: 'templar-rule-entry' });
      row.draggable = true;
      row.dataset.ruleIndex = String(index);
      row.addEventListener('dragstart', (event) => event.dataTransfer?.setData('text/plain', String(index)));
      row.addEventListener('dragover', (event) => event.preventDefault());
      row.addEventListener('drop', (event) => {
        event.preventDefault();
        const from = Number(event.dataTransfer?.getData('text/plain'));
        if (Number.isInteger(from)) runUserAction(() => this.moveTo(from, index), 'Could not reorder style rules');
      });
      row.createSpan({ cls: 'templar-drag-handle', text: '⋮⋮', attr: { title: 'Drag to reorder', 'aria-hidden': 'true' } });
      const enabled = row.createEl('input', { attr: { type: 'checkbox', 'aria-label': `Enable ${rule.name}` } });
      enabled.checked = rule.enabled;
      enabled.addEventListener('change', () => {
        runUserAction(() => this.plugin.updateSettings((draft) => {
          const target = draft.styleRules.find((candidate) => candidate.id === rule.id);
          if (target) target.enabled = enabled.checked;
        }), 'Could not update the style rule');
      });
      const summary = row.createDiv({ cls: 'templar-rule-summary' });
      summary.createDiv({ cls: 'templar-rule-name', text: rule.name });
      summary.createDiv({ text: `${rule.conditions.length} ${rule.conditions.length === 1 ? 'condition' : 'conditions'} · ${this.plugin.library.get(rule.templateId)?.name ?? 'Missing style'}` });
      const up = row.createEl('button', { text: 'Move up', attr: { 'aria-label': `Move ${rule.name} up` } });
      up.disabled = index === 0;
      up.addEventListener('click', () => runUserAction(() => this.move(index, -1), 'Could not reorder style rules'));
      const down = row.createEl('button', { text: 'Move down', attr: { 'aria-label': `Move ${rule.name} down` } });
      down.disabled = index === this.plugin.settings.styleRules.length - 1;
      down.addEventListener('click', () => runUserAction(() => this.move(index, 1), 'Could not reorder style rules'));
      const preview = row.createEl('button', { text: 'Preview existing matches' });
      preview.addEventListener('click', () => this.previewMatches(rule));
      const edit = row.createEl('button', { text: 'Edit' });
      edit.addEventListener('click', () => new StyleRuleEditorModal(this.plugin, index, () => this.render()).open());
      const remove = row.createEl('button', { text: 'Delete' });
      remove.addEventListener('click', () => runUserAction(() => this.remove(index), 'Could not delete the style rule'));
    });
  }

  private async move(index: number, delta: -1 | 1): Promise<void> {
    const rules = this.plugin.settings.styleRules;
    const target = index + delta;
    if (target < 0 || target >= rules.length) return;
    await this.plugin.updateSettings((draft) => {
      [draft.styleRules[index], draft.styleRules[target]] = [
        draft.styleRules[target]!,
        draft.styleRules[index]!,
      ];
    });
    this.render();
  }

  private async moveTo(from: number, to: number): Promise<void> {
    const rules = this.plugin.settings.styleRules;
    if (from < 0 || from >= rules.length || to < 0 || to >= rules.length || from === to) return;
    await this.plugin.updateSettings((draft) => {
      const [rule] = draft.styleRules.splice(from, 1);
      if (rule) draft.styleRules.splice(to, 0, rule);
    });
    this.render();
  }

  private async remove(index: number): Promise<void> {
    await this.plugin.updateSettings((draft) => {
      draft.styleRules.splice(index, 1);
    });
    this.render();
  }

  private previewMatches(rule: StyleRule): void {
    const matches: TFile[] = [];
    let unavailable = 0;
    const needsMetadata = rule.conditions.some((condition) => condition.type === 'tag' || condition.type === 'frontmatter');
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const facts = {
        path: file.path,
        basename: file.basename,
        folder: file.parent?.path ?? '',
        tags: cache ? getAllTags(cache) ?? [] : [],
        frontmatter: cache?.frontmatter ?? {},
        metadataReady: cache !== null,
      };
      if (!cache && needsMetadata) {
        const staticConditions = rule.conditions.filter((condition) => condition.type === 'folder' || condition.type === 'filename');
        if (staticConditions.length === 0 || ruleMatches({ ...rule, conditions: staticConditions }, facts)) unavailable += 1;
      } else if (ruleMatches(rule, facts)) {
        matches.push(file);
      }
    }
    const eligible = matches.filter((file) => this.plugin.frontmatter.inspect(file).status === 'absent');
    const styled = matches.length - eligible.length;
    const missingTemplate = this.plugin.library.get(rule.templateId) === null;
    const invalid = missingTemplate ? eligible.length : 0;
    const eligibleCount = missingTemplate ? 0 : eligible.length;
    new ConfirmationModal(this.plugin, `${String(matches.length)} notes match “${rule.name}”`, `${String(eligibleCount)} unstyled and eligible; ${String(styled)} already styled and will be skipped; ${String(unavailable + invalid)} unavailable or invalid.`, async () => {
      const template = this.plugin.library.get(rule.templateId);
      if (!template) throw new Error('The rule’s style no longer exists.');
      const page = { ...clone(DEFAULT_PAGE_OPTIONS), ...pageFlowOptions(rule.pageFlow === 'default' ? this.plugin.settings.defaultNewPageFlow : rule.pageFlow) };
      const summary = await this.plugin.application.applyBatch({
        files: eligible,
        template,
        appliedByRule: { id: rule.id, name: rule.name },
        decide: (_file, inspection) => inspection.status === 'absent'
          ? { kind: 'apply' as const, pageOptions: clone(page) }
          : { kind: 'skip' as const, message: 'Existing or protected Templar data was not overwritten.' },
        yieldEvery: 20,
        yieldToHost: () => new Promise<void>((resolve) => {
          const view = this.contentEl.ownerDocument.defaultView;
          if (view) view.setTimeout(resolve, 0); else resolve();
        }),
      });
      this.plugin.refreshSidebars();
      new Notice(`Applied “${template.name}” to ${String(summary.succeeded)} eligible notes.`);
    }, `Apply to ${String(eligibleCount)} eligible notes`).open();
  }
}

class StyleRuleEditorModal extends Modal {
  private readonly rule: StyleRule;

  public constructor(
    private readonly plugin: TemplarPlugin,
    private readonly index: number | null,
    private readonly changed: () => void,
  ) {
    super(plugin.app);
    this.rule = index === null
      ? { id: `rule-${Date.now().toString(36)}`, name: 'New rule', enabled: true, conditions: [{ type: 'folder', folder: '', includeSubfolders: true }], templateId: plugin.settings.defaultTemplateId, pageFlow: 'default' }
      : clone(plugin.settings.styleRules[index]!);
  }

  public onOpen(): void { this.setTitle(this.index === null ? 'Add Style Rule' : 'Edit Style Rule'); this.render(); }

  private render(): void {
    this.contentEl.empty();
    new Setting(this.contentEl).setName('Name').addText((text) => text.setValue(this.rule.name).onChange((value) => { this.rule.name = value; }));
    const options: Record<string, string> = {};
    for (const template of this.plugin.library.all()) options[template.id] = template.name;
    new Setting(this.contentEl).setName('Style to apply').addDropdown((dropdown) => dropdown.addOptions(options).setValue(this.rule.templateId).onChange((value) => { this.rule.templateId = value; }));
    new Setting(this.contentEl).setName('Default page behavior').addDropdown((dropdown) => dropdown.addOptions({ default: 'Use default page flow', pageless: 'Pageless', 'paged-a4': 'Paged A4', 'paged-letter': 'Paged Letter' }).setValue(this.rule.pageFlow).onChange((value) => { this.rule.pageFlow = value as StyleRule['pageFlow']; }));
    this.contentEl.createEl('h3', { text: 'Conditions (all must match)' });
    const conditions = this.contentEl.createDiv({ cls: 'templar-rule-conditions' });
    this.rule.conditions.forEach((condition, index) => this.renderCondition(conditions, condition, index));
    const add = this.contentEl.createEl('button', { text: 'Add condition' });
    add.addEventListener('click', () => { this.rule.conditions.push({ type: 'tag', tag: '' }); this.render(); });
    const actions = this.contentEl.createDiv({ cls: 'modal-button-container' });
    const cancel = actions.createEl('button', { text: 'Cancel' }); cancel.addEventListener('click', () => this.close());
    const save = actions.createEl('button', { cls: 'mod-cta', text: 'Save rule' }); save.addEventListener('click', () => void runButtonAction(save, async () => this.save()));
  }

  private renderCondition(container: HTMLElement, condition: StyleRuleCondition, index: number): void {
    const row = container.createDiv({ cls: 'templar-rule-condition' });
    const type = row.createEl('select', { attr: { 'aria-label': `Condition ${String(index + 1)} type` } });
    for (const [value, label] of [['folder', 'Folder'], ['tag', 'Tag'], ['filename', 'Filename'], ['frontmatter', 'Frontmatter property']] as const) type.createEl('option', { value, text: label });
    type.value = condition.type;
    type.addEventListener('change', () => {
      this.rule.conditions[index] = type.value === 'folder' ? { type: 'folder', folder: '', includeSubfolders: true }
        : type.value === 'tag' ? { type: 'tag', tag: '' }
          : type.value === 'filename' ? { type: 'filename', operator: 'contains', value: '' }
            : { type: 'frontmatter', property: '', value: '' };
      this.render();
    });
    if (condition.type === 'folder') {
      const input = row.createEl('input', { attr: { type: 'text', placeholder: 'Projects/research', 'aria-label': 'Folder path' } }); input.value = condition.folder; input.addEventListener('input', () => { condition.folder = input.value; });
      const label = row.createEl('label'); const check = label.createEl('input', { attr: { type: 'checkbox' } }); check.checked = condition.includeSubfolders; check.addEventListener('change', () => { condition.includeSubfolders = check.checked; }); label.createSpan({ text: 'Include subfolders' });
    } else if (condition.type === 'tag') {
      const input = row.createEl('input', { attr: { type: 'text', placeholder: 'Meeting', 'aria-label': 'Tag' } }); input.value = condition.tag; input.addEventListener('input', () => { condition.tag = input.value.replace(/^#/, ''); });
    } else if (condition.type === 'filename') {
      const operator = row.createEl('select', { attr: { 'aria-label': 'Filename match type' } });
      for (const [value, label] of [['starts-with', 'Starts with'], ['ends-with', 'Ends with'], ['contains', 'Contains'], ['exact', 'Exact match']] as const) operator.createEl('option', { value, text: label });
      operator.value = condition.operator; operator.addEventListener('change', () => { condition.operator = operator.value as typeof condition.operator; });
      const input = row.createEl('input', { attr: { type: 'text', 'aria-label': 'Filename value' } }); input.value = condition.value; input.addEventListener('input', () => { condition.value = input.value; });
    } else {
      const property = row.createEl('input', { attr: { type: 'text', placeholder: 'Status', 'aria-label': 'Frontmatter property' } }); property.value = condition.property; property.addEventListener('input', () => { condition.property = property.value; });
      const value = row.createEl('input', { attr: { type: 'text', placeholder: 'Published', 'aria-label': 'Frontmatter value' } }); value.value = condition.value; value.addEventListener('input', () => { condition.value = value.value; });
    }
    const remove = row.createEl('button', { text: 'Remove', attr: { 'aria-label': `Remove condition ${String(index + 1)}` } });
    remove.addEventListener('click', () => { this.rule.conditions.splice(index, 1); this.render(); });
  }

  private async save(): Promise<void> {
    if (!this.rule.name.trim() || this.rule.conditions.length === 0) throw new Error('Give the rule a name and at least one condition.');
    const empty = this.rule.conditions.some((condition) => condition.type === 'folder' ? !condition.folder.trim() : condition.type === 'tag' ? !condition.tag.trim() : condition.type === 'filename' ? !condition.value.trim() : !condition.property.trim());
    if (empty) throw new Error('Complete every condition before saving.');
    await this.plugin.updateSettings((draft) => {
      if (this.index === null) {
        draft.styleRules.push(clone(this.rule));
      } else if (draft.styleRules[this.index]) {
        draft.styleRules[this.index] = clone(this.rule);
      }
    });
    this.changed();
    this.close();
  }
}
