import type { TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import { clone } from '../utils/value';
import { pageFlowOptions } from './style-rules';
import type { FrontmatterService } from './frontmatter';
import type { NoteStyleIndex } from './note-style-index';
import {
  summarizeFileOperations,
  type BatchOperationSummary,
  type FileOperationResult,
  type FileOperationWarning,
} from './operation-result';
import type { TemplateLibrary } from './template-library';

export interface ApplyTemplateRequest {
  file: TFile;
  template: TemplarTemplate;
  pageOptions?: NotePageOptions;
  appliedByRule?: { id: string; name: string };
  recordRecent?: boolean;
  refresh?: 'immediate' | 'deferred';
}

export interface BatchApplyRequest {
  files: readonly TFile[];
  template: TemplarTemplate;
  resolvePageOptions: (file: TFile, current: TemplarNoteStyle | null) => NotePageOptions | null;
  yieldEvery?: number;
  yieldToHost?: () => Promise<void>;
}

export interface StyleApplicationDependencies {
  frontmatter: FrontmatterService;
  library: TemplateLibrary;
  usageIndex: NoteStyleIndex;
  settings: { defaultNewPageFlow: 'pageless' | 'paged-a4' | 'paged-letter' };
  refreshFile: (file: TFile) => Promise<void>;
  refreshDeferred: () => void;
  getCurrentFile?: (path: string) => TFile | null;
}

/** One application-level contract for note writes, recents, index, and refresh. */
export class StyleApplicationService {
  public constructor(private readonly dependencies: StyleApplicationDependencies) {}

  public async writeStyle(
    file: TFile,
    style: TemplarNoteStyle,
    refresh: 'immediate' | 'deferred' = 'immediate',
  ): Promise<FileOperationResult> {
    await this.dependencies.frontmatter.writeStyle(file, style);
    return this.completeWrite(file, refresh);
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
    refresh: 'immediate' | 'deferred' = 'immediate',
  ): Promise<FileOperationResult> {
    await this.dependencies.frontmatter.patchPageOptions(file, pageOptions);
    return this.completeWrite(file, refresh);
  }

  public async removeStyle(
    file: TFile,
    refresh: 'immediate' | 'deferred' = 'immediate',
  ): Promise<FileOperationResult> {
    await this.dependencies.frontmatter.removeStyle(file);
    return this.completeWrite(file, refresh);
  }

  public async apply(request: ApplyTemplateRequest): Promise<FileOperationResult> {
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

    return this.completeWrite(request.file, request.refresh ?? 'immediate', () => {
      if (request.recordRecent !== false && !request.appliedByRule) {
        return this.dependencies.library.recordRecent(request.template.id);
      }
      return Promise.resolve();
    }, 'recent');
  }

  public async applyBatch(request: BatchApplyRequest): Promise<BatchOperationSummary> {
    const frozenFiles = Object.freeze([...request.files]);
    const results: FileOperationResult[] = [];
    const yieldEvery = Math.max(1, Math.floor(request.yieldEvery ?? 20));
    const yieldToHost = request.yieldToHost ?? (() => Promise.resolve());

    for (let index = 0; index < frozenFiles.length; index += 1) {
      const frozenFile = frozenFiles[index]!;
      const currentFile = this.dependencies.getCurrentFile
        ? this.dependencies.getCurrentFile(frozenFile.path)
        : frozenFile;
      const isMarkdown = currentFile !== null &&
        currentFile.path === frozenFile.path &&
        (currentFile.extension === undefined || currentFile.extension === 'md');

      if (!isMarkdown) {
        results.push(skippedResult(frozenFile.path, 'The note no longer exists as a Markdown file.'));
      } else {
        try {
          const pageOptions = request.resolvePageOptions(
            currentFile,
            this.dependencies.frontmatter.getStyle(currentFile),
          );
          if (!pageOptions) {
            results.push(skippedResult(frozenFile.path, 'The note was skipped by the frozen request.'));
          } else {
            results.push(await this.apply({
              file: currentFile,
              template: request.template,
              pageOptions,
              recordRecent: false,
              refresh: 'deferred',
            }));
          }
        } catch (error) {
          results.push({
            path: frozenFile.path,
            status: 'failed',
            noteWritten: false,
            refreshed: false,
            warnings: [],
            message: errorMessage(error),
          });
        }
      }

      if ((index + 1) % yieldEvery === 0) await yieldToHost();
    }

    if (results.some((result) => result.noteWritten)) {
      try {
        this.dependencies.refreshDeferred();
      } catch (error) {
        const warning: FileOperationWarning = {
          stage: 'refresh',
          message: `The notes were written, but the final refresh failed: ${errorMessage(error)}`,
        };
        for (const result of results) {
          if (result.noteWritten) result.warnings.push(warning);
        }
      }
    }
    return summarizeFileOperations(results);
  }

  private async completeWrite(
    file: TFile,
    refresh: 'immediate' | 'deferred',
    afterWrite?: () => Promise<void>,
    afterWriteStage: 'recent' = 'recent',
  ): Promise<FileOperationResult> {
    const warnings: FileOperationWarning[] = [];
    try {
      this.updateIndex(file);
    } catch (error) {
      warnings.push({ stage: 'index', message: `The note was written, but the style index could not be updated: ${errorMessage(error)}` });
    }

    if (afterWrite) {
      try {
        await afterWrite();
      } catch (error) {
        warnings.push({ stage: afterWriteStage, message: `The note was written, but Recent could not be saved: ${errorMessage(error)}` });
      }
    }

    let refreshed = false;
    if (refresh === 'immediate') {
      try {
        await this.dependencies.refreshFile(file);
        refreshed = true;
      } catch (error) {
        warnings.push({ stage: 'refresh', message: `The note was written, but it could not be refreshed: ${errorMessage(error)}` });
      }
    }

    return {
      path: file.path,
      status: 'succeeded',
      noteWritten: true,
      refreshed,
      warnings,
    };
  }

  private updateIndex(file: TFile, style = this.dependencies.frontmatter.getStyle(file)): void {
    if (!this.dependencies.usageIndex.isBuilt()) return;
    this.dependencies.usageIndex.update({
      path: file.path,
      folder: file.parent?.path ?? '',
      style,
    });
  }
}

function skippedResult(path: string, message: string): FileOperationResult {
  return {
    path,
    status: 'skipped',
    noteWritten: false,
    refreshed: false,
    warnings: [],
    message,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
