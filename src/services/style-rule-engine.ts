import {
  getAllTags,
  type App,
  type TFile,
} from 'obsidian';
import type { NotePageOptions, TemplarSettings, TemplarTemplate } from '../types';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import { clone } from '../utils/value';
import { firstMatchingRule, pageFlowOptions } from './style-rules';
import type { FrontmatterService } from './frontmatter';
import type { FrontmatterWriteGuard } from './frontmatter';
import type { TemplateLibrary } from './template-library';

export interface StyleRuleEngineDependencies {
  app: App;
  settings: TemplarSettings;
  library: TemplateLibrary;
  frontmatter: FrontmatterService;
  isReady: () => boolean;
  apply: (request: {
    template: TemplarTemplate;
    file: TFile;
    pageOptions: NotePageOptions;
    appliedByRule: { id: string; name: string };
    guard: FrontmatterWriteGuard;
  }) => Promise<void>;
}

/** Evaluates metadata-dependent rules without making the plugin root a rule engine. */
export class StyleRuleEngine {
  public constructor(private readonly dependencies: StyleRuleEngineDependencies) {}

  public async evaluate(file: TFile, metadataReady: boolean): Promise<void> {
    const { app, settings, library, frontmatter } = this.dependencies;
    const inspection = frontmatter.inspect(file);
    if (!this.dependencies.isReady() || inspection.status !== 'absent') return;
    const cache = app.metadataCache.getFileCache(file);
    const rule = firstMatchingRule(settings.styleRules, {
      path: file.path,
      basename: file.basename,
      folder: file.parent?.path ?? '',
      tags: cache ? getAllTags(cache) ?? [] : [],
      frontmatter: cache?.frontmatter ?? {},
      metadataReady: metadataReady && cache !== null,
    });
    if (!rule) return;
    const template = library.get(rule.templateId);
    if (!template) return;
    const flow = pageFlowOptions(
      rule.pageFlow === 'default' ? settings.defaultNewPageFlow : rule.pageFlow,
    );
    await this.dependencies.apply({
      template,
      file,
      pageOptions: { ...clone(DEFAULT_PAGE_OPTIONS), ...flow },
      appliedByRule: { id: rule.id, name: rule.name },
      guard: { expectedRawFingerprint: inspection.fingerprint },
    });
  }
}
