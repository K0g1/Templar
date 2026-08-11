import type { TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import { clone } from '../utils/value';
import { pageFlowOptions } from './style-rules';
import type { FrontmatterService } from './frontmatter';
import type { NoteStyleIndex } from './note-style-index';
import type { TemplateLibrary } from './template-library';
import type { FileOperationResult } from './operation-result';

export interface ApplyTemplateRequest {
  file: TFile;
  template: TemplarTemplate;
  pageOptions?: NotePageOptions;
  appliedByRule?: { id: string; name: string };
  recordRecent?: boolean;
  refresh?: 'immediate' | 'deferred';
}

export interface ApplyTemplateResult {
  file: TFile;
  noteWritten: boolean;
  recentRecorded: boolean;
  warnings: string[];
}

export interface StyleApplicationDependencies {
  frontmatter: FrontmatterService;
  library: TemplateLibrary;
  usageIndex: NoteStyleIndex;
  settings: { defaultNewPageFlow: 'pageless' | 'paged-a4' | 'paged-letter' };
  refreshFile: (file: TFile) => Promise<void>;
  refreshDeferred: () => void;
}

/** One application-level contract for note writes, recents, index, and refresh. */
export class StyleApplicationService {
  public constructor(private readonly dependencies: StyleApplicationDependencies) {}

  public async writeStyle(
    file: TFile,
    style: TemplarNoteStyle,
    refresh: 'immediate' | 'deferred' = 'immediate',
  ): Promise<void> {
    await this.dependencies.frontmatter.writeStyle(file, style);
    this.updateIndex(file);
    await this.refresh(file, refresh);
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
  ): Promise<void> {
    await this.dependencies.frontmatter.patchPageOptions(file, pageOptions);
    this.updateIndex(file);
    await this.dependencies.refreshFile(file);
  }

  public async removeStyle(
    file: TFile,
    refresh: 'immediate' | 'deferred' = 'immediate',
  ): Promise<void> {
    await this.dependencies.frontmatter.removeStyle(file);
    this.updateIndex(file, null);
    await this.refresh(file, refresh);
  }

  public async apply(request: ApplyTemplateRequest): Promise<ApplyTemplateResult> {
    const existing = this.dependencies.frontmatter.getStyle(request.file);
    const resolvedPageOptions = request.pageOptions
      ? clone(request.pageOptions)
      : clone(existing?.page ?? {
        ...clone(DEFAULT_PAGE_OPTIONS),
        ...pageFlowOptions(this.dependencies.settings.defaultNewPageFlow),
      });

    await this.dependencies.frontmatter.applyTemplate(
      request.file,
      request.template,
      resolvedPageOptions,
      request.appliedByRule,
    );

    this.updateIndex(request.file);

    const warnings: string[] = [];
    let recentRecorded = false;
    if (request.recordRecent !== false && !request.appliedByRule) {
      try {
        await this.dependencies.library.recordRecent(request.template.id);
        recentRecorded = true;
      } catch (error) {
        warnings.push(`The note was styled, but Recent could not be saved: ${errorMessage(error)}`);
      }
    }

    if (request.refresh !== 'deferred') await this.dependencies.refreshFile(request.file);
    else this.dependencies.refreshDeferred();
    return { file: request.file, noteWritten: true, recentRecorded, warnings };
  }

  public async applyBatch(
    files: readonly TFile[],
    template: TemplarTemplate,
    pageOptions: (file: TFile, current: TemplarNoteStyle | null) => NotePageOptions,
  ): Promise<FileOperationResult[]> {
    const frozenFiles = [...files];
    const results: FileOperationResult[] = frozenFiles.map((file) => ({
      path: file.path,
      status: 'pending',
    }));
    for (let index = 0; index < frozenFiles.length; index += 1) {
      const file = frozenFiles[index]!;
      try {
        await this.apply({
          file,
          template,
          pageOptions: pageOptions(file, this.dependencies.frontmatter.getStyle(file)),
          recordRecent: false,
          refresh: 'deferred',
        });
        results[index] = { path: file.path, status: 'succeeded' };
      } catch (error) {
        results[index] = {
          path: file.path,
          status: 'failed',
          message: errorMessage(error),
        };
      }
      if ((index + 1) % 20 === 0) {
        await Promise.resolve();
      }
    }
    this.dependencies.refreshDeferred();
    return results;
  }

  private updateIndex(file: TFile, style = this.dependencies.frontmatter.getStyle(file)): void {
    if (!this.dependencies.usageIndex.isBuilt()) return;
    this.dependencies.usageIndex.update({
      path: file.path,
      folder: file.parent?.path ?? '',
      style,
    });
  }

  private async refresh(file: TFile, mode: 'immediate' | 'deferred'): Promise<void> {
    if (mode === 'deferred') this.dependencies.refreshDeferred();
    else await this.dependencies.refreshFile(file);
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
