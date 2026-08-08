import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

function templarLineRange(view: EditorView): { startLine: number; endLine: number } | null {
  const document = view.state.doc;
  if (document.lines < 3 || document.line(1).text.trim() !== '---') {
    return null;
  }

  let closingLine = 0;
  for (let lineNumber = 2; lineNumber <= document.lines; lineNumber += 1) {
    if (document.line(lineNumber).text.trim() === '---') {
      closingLine = lineNumber;
      break;
    }
  }
  if (closingLine === 0) {
    return null;
  }

  let startLine = 0;
  for (let lineNumber = 2; lineNumber < closingLine; lineNumber += 1) {
    if (/^templar\s*:/.test(document.line(lineNumber).text)) {
      startLine = lineNumber;
      break;
    }
  }
  if (startLine === 0) {
    return null;
  }

  let endLine = closingLine - 1;
  for (let lineNumber = startLine + 1; lineNumber < closingLine; lineNumber += 1) {
    const text = document.line(lineNumber).text;
    // Any non-comment content beginning at indentation zero belongs to the
    // next top-level YAML node. This covers quoted, Unicode, and spaced keys.
    if (/^\S/.test(text) && !text.startsWith('#')) {
      endLine = lineNumber - 1;
      break;
    }
  }
  return { startLine, endLine };
}

function buildDecorations(view: EditorView, enabled: () => boolean): DecorationSet {
  if (!enabled()) {
    return Decoration.none;
  }
  const range = templarLineRange(view);
  if (!range) {
    return Decoration.none;
  }
  const decorations = [];
  for (let lineNumber = range.startLine; lineNumber <= range.endLine; lineNumber += 1) {
    decorations.push(
      Decoration.line({
        attributes: {
          class: 'templar-hidden-frontmatter-line',
          'aria-hidden': 'true',
        },
      }).range(view.state.doc.line(lineNumber).from),
    );
  }
  return Decoration.set(decorations, true);
}

export function createHideMetadataExtension(enabled: () => boolean): ViewPlugin<{
  decorations: DecorationSet;
  update: (update: ViewUpdate) => void;
}> {
  return ViewPlugin.fromClass(
    class {
      public decorations: DecorationSet;

      public constructor(view: EditorView) {
        this.decorations = buildDecorations(view, enabled);
      }

      public update(update: ViewUpdate): void {
        if (update.docChanged || update.viewportChanged || update.focusChanged) {
          this.decorations = buildDecorations(update.view, enabled);
        }
      }
    },
    { decorations: (value) => value.decorations },
  );
}
