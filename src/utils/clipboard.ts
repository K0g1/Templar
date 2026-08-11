/**
 * Copies text in both secure desktop contexts and mobile WebViews.
 *
 * Obsidian Mobile can deny the asynchronous Clipboard API depending on the
 * platform and permission state, so keep a DOM-based fallback. The helper is
 * intentionally local and removed immediately after copying.
 */
export async function writeTextToClipboard(
  text: string,
  ownerDocument: Document = document,
): Promise<void> {
  const clipboard = ownerDocument.defaultView?.navigator.clipboard;
  if (clipboard) {
    try {
      await clipboard.writeText(text);
      return;
    } catch {
      // Continue to the selection-based fallback below.
    }
  }

  const previous = ownerDocument.activeElement;
  const helper = ownerDocument.createElement('textarea');
  helper.className = 'templar-clipboard-helper';
  helper.value = text;
  helper.setAttribute('readonly', '');
  ownerDocument.body.append(helper);
  try {
    helper.focus({ preventScroll: true });
    helper.select();
    helper.setSelectionRange(0, helper.value.length);
    const copied = ownerDocument.execCommand('copy');
    if (!copied) {
      throw new Error('The clipboard is unavailable.');
    }
  } finally {
    helper.remove();
    const HTMLElementConstructor = ownerDocument.defaultView?.HTMLElement;
    if (
      previous &&
      HTMLElementConstructor &&
      previous.instanceOf(HTMLElementConstructor) &&
      previous.isConnected &&
      (previous.tabIndex >= 0 || previous.matches('button, input, select, textarea, a[href], [contenteditable="true"]'))
    ) {
      previous.focus({ preventScroll: true });
    }
  }
}
