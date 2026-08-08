import type { App, TFile } from 'obsidian';
import type { NotePageOptions, TemplarNoteStyle, TemplarTemplate } from '../types';
import { frontmatterToNoteStyle, noteStyleToFrontmatter, templateToNoteStyle } from '../templates/note-format';
import { normalizePageOptions } from '../templates/schema';

export class FrontmatterService {
  private readonly optimisticStyles = new Map<string, TemplarNoteStyle | null>();

  public constructor(private readonly app: App) {}

  public getStyle(file: TFile): TemplarNoteStyle | null {
    if (this.optimisticStyles.has(file.path)) {
      return this.optimisticStyles.get(file.path) ?? null;
    }
    const cache = this.app.metadataCache.getFileCache(file);
    return frontmatterToNoteStyle(cache?.frontmatter?.templar);
  }

  public hasStyle(file: TFile): boolean {
    return this.getStyle(file) !== null;
  }

  public async applyTemplate(
    file: TFile,
    template: TemplarTemplate,
    pageOptions?: NotePageOptions,
  ): Promise<void> {
    const style = templateToNoteStyle(template, pageOptions);
    this.optimisticStyles.set(file.path, style);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.templar = noteStyleToFrontmatter(style);
      });
    } catch (error) {
      this.optimisticStyles.delete(file.path);
      throw error;
    }
  }

  public async writeStyle(file: TFile, style: TemplarNoteStyle): Promise<void> {
    this.optimisticStyles.set(file.path, style);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        frontmatter.templar = noteStyleToFrontmatter(style);
      });
    } catch (error) {
      this.optimisticStyles.delete(file.path);
      throw error;
    }
  }

  public async patchPageOptions(
    file: TFile,
    pageOptions: NotePageOptions,
  ): Promise<void> {
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        const current = frontmatterToNoteStyle(frontmatter.templar);
        if (!current) {
          throw new Error('The note no longer has a Templar style.');
        }
        current.page = normalizePageOptions(pageOptions);
        this.optimisticStyles.set(file.path, current);
        frontmatter.templar = noteStyleToFrontmatter(current);
      });
    } catch (error) {
      this.optimisticStyles.delete(file.path);
      throw error;
    }
  }

  public async removeStyle(file: TFile): Promise<void> {
    this.optimisticStyles.set(file.path, null);
    try {
      await this.app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
        delete frontmatter.templar;
      });
    } catch (error) {
      this.optimisticStyles.delete(file.path);
      throw error;
    }
  }

  public settle(file: TFile): void {
    this.optimisticStyles.delete(file.path);
  }

  public rename(oldPath: string, newPath: string): void {
    if (!this.optimisticStyles.has(oldPath)) {
      return;
    }
    const style = this.optimisticStyles.get(oldPath) ?? null;
    this.optimisticStyles.delete(oldPath);
    this.optimisticStyles.set(newPath, style);
  }

  public forget(path: string): void {
    this.optimisticStyles.delete(path);
  }
}
