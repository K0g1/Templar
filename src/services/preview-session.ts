import type { TFile, WorkspaceLeaf } from 'obsidian';
import { DEFAULT_PAGE_OPTIONS } from '../templates/defaults';
import { templateToNoteStyle } from '../templates/note-format';
import type { NotePageOptions, TemplarNoteStyle, TemplarSettings, TemplarTemplate } from '../types';
import { clone } from '../utils/value';
import type { FrontmatterService } from './frontmatter';
import type { PageRenderer } from './page-renderer';
import { pageFlowOptions } from './style-rules';

export interface PreviewSession {
  owner: string;
  leaf: WorkspaceLeaf;
  file: TFile;
  templateId: string;
  templateName: string;
  style: TemplarNoteStyle;
}

export class PreviewSessionService {
  private readonly sessions = new Map<string, PreviewSession>();
  private readonly leafOwners = new Map<WorkspaceLeaf, string>();
  private readonly pendingFrames = new Map<string, number>();

  public constructor(
    private readonly settings: TemplarSettings,
    private readonly frontmatter: FrontmatterService,
    private readonly renderer: PageRenderer,
  ) {}

  public preview(
    owner: string,
    leaf: WorkspaceLeaf,
    file: TFile,
    template: TemplarTemplate,
  ): void {
    const previousOwner = this.leafOwners.get(leaf);
    if (previousOwner && previousOwner !== owner) void this.cancel(previousOwner);
    const page = this.pageOptions(file);
    const style = templateToNoteStyle(template, page);
    const session: PreviewSession = {
      owner,
      leaf,
      file,
      templateId: template.id,
      templateName: template.name,
      style,
    };
    this.sessions.set(owner, session);
    this.leafOwners.set(leaf, owner);
    this.cancelFrame(owner);
    const view = leaf.view.containerEl.ownerDocument.defaultView;
    if (!view) {
      void this.renderer.setPreview(leaf, owner, file.path, style);
      return;
    }
    const frame = view.requestAnimationFrame(() => {
      this.pendingFrames.delete(owner);
      if (this.sessions.get(owner) === session) {
        void this.renderer.setPreview(leaf, owner, file.path, style);
      }
    });
    this.pendingFrames.set(owner, frame);
  }

  public previewStyle(
    owner: string,
    leaf: WorkspaceLeaf,
    file: TFile,
    style: TemplarNoteStyle,
  ): void {
    const session: PreviewSession = {
      owner,
      leaf,
      file,
      templateId: style.sourceTemplateId ?? style.id,
      templateName: style.name,
      style: clone(style),
    };
    const previousOwner = this.leafOwners.get(leaf);
    if (previousOwner && previousOwner !== owner) void this.cancel(previousOwner);
    this.sessions.set(owner, session);
    this.leafOwners.set(leaf, owner);
    this.cancelFrame(owner);
    const view = leaf.view.containerEl.ownerDocument.defaultView;
    if (!view) {
      void this.renderer.setPreview(leaf, owner, file.path, style);
      return;
    }
    this.pendingFrames.set(owner, view.requestAnimationFrame(() => {
      this.pendingFrames.delete(owner);
      if (this.sessions.get(owner) === session) {
        void this.renderer.setPreview(leaf, owner, file.path, session.style);
      }
    }));
  }

  public current(owner?: string): PreviewSession | null {
    const session = owner ? this.sessions.get(owner) : [...this.sessions.values()][0];
    return session ? { ...session, style: clone(session.style) } : null;
  }

  public currentForLeaf(leaf: WorkspaceLeaf): PreviewSession | null {
    const owner = this.leafOwners.get(leaf);
    return owner ? this.current(owner) : null;
  }

  public currentForDocument(document: Document): PreviewSession | null {
    const owner = [...this.sessions.values()]
      .find((session) => session.leaf.view.containerEl.ownerDocument === document)
      ?.owner;
    return owner ? this.current(owner) : null;
  }

  public async cancel(owner: string): Promise<void> {
    this.cancelFrame(owner);
    const session = this.sessions.get(owner);
    if (!session) return;
    this.sessions.delete(owner);
    if (this.leafOwners.get(session.leaf) === owner) this.leafOwners.delete(session.leaf);
    await this.renderer.cancelPreview(session.leaf, owner);
  }

  public async cancelLeaf(leaf: WorkspaceLeaf): Promise<void> {
    const owner = this.leafOwners.get(leaf);
    if (owner) await this.cancel(owner);
  }

  public async cancelAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map(async (owner) => this.cancel(owner)));
  }

  public async cancelMismatchedLeaves(): Promise<void> {
    for (const [owner, session] of [...this.sessions]) {
      const view = session.leaf.view as {
        file?: TFile | null;
        getViewType?: () => string;
      };
      const viewFile = view.file ?? null;
      if (!viewFile && view.getViewType?.() === 'markdown') {
        // Obsidian temporarily clears MarkdownView.file while rebuilding the
        // same leaf for a Source/Live Preview/Reading mode change. That is not
        // a note change and must not end an in-memory try-on session.
        continue;
      }
      if (!viewFile || viewFile.path !== session.file.path) await this.cancel(owner);
    }
  }

  public async cancelMissingLeaves(openLeaves: ReadonlySet<WorkspaceLeaf>): Promise<boolean> {
    const owners = [...this.sessions]
      .filter(([, session]) => !openLeaves.has(session.leaf))
      .map(([owner]) => owner);
    await Promise.all(owners.map(async (owner) => this.cancel(owner)));
    return owners.length > 0;
  }

  public destroy(): void {
    for (const owner of this.pendingFrames.keys()) this.cancelFrame(owner);
    for (const owner of this.sessions.keys()) this.renderer.cancelPreviewsByOwner(owner);
    this.sessions.clear();
    this.leafOwners.clear();
  }

  private pageOptions(file: TFile): NotePageOptions {
    const existing = this.frontmatter.getStyle(file)?.page;
    if (existing) return clone(existing);
    const flow = pageFlowOptions(this.settings.defaultNewPageFlow);
    return { ...clone(DEFAULT_PAGE_OPTIONS), ...flow };
  }

  private cancelFrame(owner: string): void {
    const frame = this.pendingFrames.get(owner);
    if (frame === undefined) return;
    const session = this.sessions.get(owner);
    session?.leaf.view.containerEl.ownerDocument.defaultView?.cancelAnimationFrame(frame);
    this.pendingFrames.delete(owner);
  }
}
