import type { PreviewSessionService } from './preview-session';

/** Bind Escape handling to the document that owns a workspace window. */
export function bindPreviewEscape(
  ownerDocument: Document,
  preview: Pick<PreviewSessionService, 'currentForDocument' | 'cancel'>,
  onCancelled: () => void,
): () => void {
  const handler = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.key !== 'Escape') return;
    const session = preview.currentForDocument(ownerDocument);
    if (!session) return;
    event.preventDefault();
    void preview.cancel(session.owner).then(onCancelled);
  };
  ownerDocument.addEventListener('keydown', handler);
  return () => ownerDocument.removeEventListener('keydown', handler);
}
