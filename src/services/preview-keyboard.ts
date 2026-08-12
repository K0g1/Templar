import type { WorkspaceLeaf } from 'obsidian';
import type { PreviewSessionService } from './preview-session';

/** Bind Escape handling to the document that owns a workspace window. */
export function bindPreviewEscape(
  ownerDocument: Document,
  preview: Pick<PreviewSessionService, 'currentForLeaf' | 'sessionsForDocument' | 'cancel'>,
  resolveActiveLeaf: () => WorkspaceLeaf | null,
  onCancelled: () => void,
): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.key !== 'Escape') return;
    const activeLeaf = resolveActiveLeaf();
    const activeDocument = activeLeaf?.view.containerEl.ownerDocument;
    const session = activeLeaf && activeDocument === ownerDocument
      ? preview.currentForLeaf(activeLeaf)
      : activeLeaf
        ? null
        : (() => {
          const sessions = preview.sessionsForDocument(ownerDocument);
          return sessions.length === 1 ? sessions[0] ?? null : null;
        })();
    if (!session) return;
    event.preventDefault();
    void preview.cancel(session.owner).then(onCancelled);
  };
  ownerDocument.addEventListener('keydown', handler);
  return () => ownerDocument.removeEventListener('keydown', handler);
}
