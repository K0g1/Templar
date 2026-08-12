import { BUILT_IN_TEMPLATES } from '../templates/builtins';
import type { TemplarSettings, TemplarTemplate } from '../types';
import { clone, slugify } from '../utils/value';
import {
  normalizeTemplate,
  normalizeTemplateFolder,
  templateFolderKey,
} from '../templates/schema';
import { validateCompleteTemplate } from '../templates/validation';
import { SettingsStore } from './settings-store';

export class TemplateLibrary {
  public constructor(
    private readonly settings: TemplarSettings,
    private readonly store: SettingsStore,
  ) {}

  public all(): TemplarTemplate[] {
    return [
      ...BUILT_IN_TEMPLATES.map((template) => clone(template)),
      ...this.settings.userTemplates.map((template) => clone(template)),
    ];
  }

  public builtIns(): TemplarTemplate[] {
    return BUILT_IN_TEMPLATES.map((template) => clone(template));
  }

  public userTemplates(): TemplarTemplate[] {
    return this.settings.userTemplates.map((template) => clone(template));
  }

  public folders(templates: readonly TemplarTemplate[] = this.all()): string[] {
    const foldersByKey = new Map<string, string>();
    for (const template of templates) {
      const folder = normalizeTemplateFolder(template.metadata.folder);
      const key = templateFolderKey(folder);
      if (!foldersByKey.has(key)) {
        foldersByKey.set(key, folder);
      }
    }
    return Array.from(foldersByKey.values()).sort((left, right) => {
      if (left === 'Unfiled') return 1;
      if (right === 'Unfiled') return -1;
      return left.localeCompare(right, undefined, { sensitivity: 'base' });
    });
  }

  public get(id: string): TemplarTemplate | null {
    const template = [...BUILT_IN_TEMPLATES, ...this.settings.userTemplates].find(
      (candidate) => candidate.id === id,
    );
    return template ? clone(template) : null;
  }

  public async save(templateValue: TemplarTemplate): Promise<TemplarTemplate> {
    const template = this.validatedTemplate(templateValue);
    template.builtIn = false;
    const saved = await this.store.transaction((draft) => {
      const candidate = clone(template);
      const index = draft.userTemplates.findIndex((item) => item.id === candidate.id);
      if (index >= 0) {
        draft.userTemplates[index] = candidate;
      } else {
        if (BUILT_IN_TEMPLATES.some((item) => item.id === candidate.id)) {
          candidate.id = this.uniqueId(candidate.id, draft);
        }
        draft.userTemplates.push(candidate);
      }
      return candidate;
    });
    return clone(saved);
  }

  public async saveAsNew(templateValue: TemplarTemplate): Promise<TemplarTemplate> {
    const template = this.validatedTemplate(templateValue);
    template.builtIn = false;
    const saved = await this.store.transaction((draft) => {
      const candidate = clone(template);
      const preferred = this.isBuiltIn(candidate.id) ? `${candidate.id}-custom` : candidate.id;
      candidate.id = this.uniqueId(preferred, draft);
      draft.userTemplates.push(candidate);
      return candidate;
    });
    return clone(saved);
  }

  public async duplicate(id: string): Promise<TemplarTemplate> {
    const source = this.get(id);
    if (!source) {
      throw new Error('The selected Page Style no longer exists.');
    }
    const saved = await this.store.transaction((draft) => {
      const candidate = clone(source);
      candidate.builtIn = false;
      candidate.name = `${candidate.name} copy`;
      candidate.id = this.uniqueId(slugify(candidate.name), draft);
      candidate.metadata.author = 'Templar user';
      draft.userTemplates.push(candidate);
      return candidate;
    });
    return clone(saved);
  }

  public async remove(id: string): Promise<boolean> {
    if (!this.settings.userTemplates.some((template) => template.id === id)) {
      return false;
    }
    return this.store.transaction((draft) => {
      const index = draft.userTemplates.findIndex((template) => template.id === id);
      if (index < 0) return false;
      draft.userTemplates.splice(index, 1);
      draft.favouriteTemplateIds = draft.favouriteTemplateIds.filter((value) => value !== id);
      draft.recentTemplateIds = draft.recentTemplateIds.filter((value) => value !== id);
      return true;
    });
  }

  public isBuiltIn(id: string): boolean {
    return BUILT_IN_TEMPLATES.some((template) => template.id === id);
  }

  public isFavourite(id: string): boolean {
    return this.settings.favouriteTemplateIds.includes(id);
  }

  public async toggleFavourite(id: string): Promise<boolean> {
    return this.store.transaction((draft) => {
      const index = draft.favouriteTemplateIds.indexOf(id);
      if (index >= 0) {
        draft.favouriteTemplateIds.splice(index, 1);
        return false;
      }
      draft.favouriteTemplateIds.push(id);
      return true;
    });
  }

  public async recordRecent(id: string): Promise<void> {
    if (!this.get(id)) return;
    await this.store.transaction((draft) => {
      const existing = draft.recentTemplateIds.indexOf(id);
      if (existing >= 0) draft.recentTemplateIds.splice(existing, 1);
      draft.recentTemplateIds.unshift(id);
      if (draft.recentTemplateIds.length > 10) draft.recentTemplateIds.length = 10;
    });
  }

  private validatedTemplate(templateValue: TemplarTemplate): TemplarTemplate {
    const template = normalizeTemplate(templateValue);
    const issues = validateCompleteTemplate(template);
    const errors = issues.filter((issue) => issue.severity === 'error');
    if (errors.length > 0) {
      throw new Error(errors.map((issue) => issue.message).join(' ') || 'The template is invalid.');
    }
    return template;
  }

  private uniqueId(preferred: string, draft: TemplarSettings): string {
    const base = slugify(preferred);
    const used = new Set([
      ...BUILT_IN_TEMPLATES.map((template) => template.id),
      ...draft.userTemplates.map((template) => template.id),
    ]);
    if (!used.has(base)) return base;
    let suffix = 2;
    while (used.has(`${base}-${String(suffix)}`)) suffix += 1;
    return `${base}-${String(suffix)}`;
  }
}
