import { BUILT_IN_TEMPLATES } from '../templates/builtins';
import type { TemplarSettings, TemplarTemplate } from '../types';
import { clone, slugify } from '../utils/value';
import { normalizeTemplate, validateTemplate } from '../templates/schema';
import { validateCustomCss } from './css-validator';

export class TemplateLibrary {
  public constructor(
    private readonly settings: TemplarSettings,
    private readonly persist: () => Promise<void>,
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

  public get(id: string): TemplarTemplate | null {
    const template = [...BUILT_IN_TEMPLATES, ...this.settings.userTemplates].find(
      (candidate) => candidate.id === id,
    );
    return template ? clone(template) : null;
  }

  public async save(templateValue: TemplarTemplate): Promise<TemplarTemplate> {
    const template = normalizeTemplate(templateValue);
    template.builtIn = false;
    const issues = [
      ...validateTemplate(template).issues,
      ...validateCustomCss(template.css).issues,
    ];
    if (issues.some((issue) => issue.severity === 'error')) {
      const details = issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join(' ');
      throw new Error(details || 'The template is invalid.');
    }

    const index = this.settings.userTemplates.findIndex((candidate) => candidate.id === template.id);
    if (index >= 0) {
      this.settings.userTemplates[index] = clone(template);
    } else {
      if (BUILT_IN_TEMPLATES.some((candidate) => candidate.id === template.id)) {
        template.id = this.uniqueId(`${template.id}-custom`);
      }
      this.settings.userTemplates.push(clone(template));
    }
    await this.persist();
    return clone(template);
  }

  public async saveAsNew(templateValue: TemplarTemplate): Promise<TemplarTemplate> {
    const template = normalizeTemplate(templateValue);
    template.builtIn = false;
    const preferred = this.isBuiltIn(template.id) ? `${template.id}-custom` : template.id;
    template.id = this.uniqueId(preferred);
    const issues = [
      ...validateTemplate(template).issues,
      ...validateCustomCss(template.css).issues,
    ];
    if (issues.some((issue) => issue.severity === 'error')) {
      const details = issues
        .filter((issue) => issue.severity === 'error')
        .map((issue) => issue.message)
        .join(' ');
      throw new Error(details || 'The template is invalid.');
    }
    this.settings.userTemplates.push(clone(template));
    await this.persist();
    return clone(template);
  }

  public async duplicate(id: string): Promise<TemplarTemplate> {
    const source = this.get(id);
    if (!source) {
      throw new Error('The selected Page Style no longer exists.');
    }
    source.builtIn = false;
    source.name = `${source.name} copy`;
    source.id = this.uniqueId(slugify(source.name));
    source.metadata.author = 'Templar user';
    this.settings.userTemplates.push(clone(source));
    await this.persist();
    return source;
  }

  public async remove(id: string): Promise<boolean> {
    const index = this.settings.userTemplates.findIndex((template) => template.id === id);
    if (index < 0) {
      return false;
    }
    this.settings.userTemplates.splice(index, 1);
    await this.persist();
    return true;
  }

  public isBuiltIn(id: string): boolean {
    return BUILT_IN_TEMPLATES.some((template) => template.id === id);
  }

  private uniqueId(preferred: string): string {
    const base = slugify(preferred);
    const used = new Set(this.all().map((template) => template.id));
    if (!used.has(base)) {
      return base;
    }
    let suffix = 2;
    while (used.has(`${base}-${String(suffix)}`)) {
      suffix += 1;
    }
    return `${base}-${String(suffix)}`;
  }
}
