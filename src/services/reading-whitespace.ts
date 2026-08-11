export interface ReadingSectionRange {
  lineStart: number;
  lineEnd: number;
  text: string;
}

/** Reading roots are reused by Obsidian as a leaf opens different files. */
export function readingRootNeedsRetarget(
  registeredPath: string | null,
  nextPath: string,
): boolean {
  return registeredPath !== nextPath;
}

/** Cached Reading Views can reconcile without a fresh post-processor context. */
export function hasReadingWhitespaceWork(
  hasContext: boolean,
  hasCurrentSection: boolean,
  registeredSectionCount: number,
): boolean {
  return hasContext || hasCurrentSection || registeredSectionCount > 0;
}

/** Obsidian reports the closing YAML delimiter, not the first body row. */
export function bodyStartLineAfterFrontmatter(frontmatterEndLine?: number): number {
  return frontmatterEndLine === undefined ? 0 : frontmatterEndLine + 1;
}

export function blankLinesBetweenSections(
  previousLineEnd: number,
  nextLineStart: number,
  source = '',
): number {
  const start = previousLineEnd + 1;
  const end = nextLineStart;
  if (!source) {
    return Math.max(0, end - start);
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return lines.slice(start, end).filter((line) => line.trim() === '').length;
}

/** Counts blank source rows before the first rendered block, after hidden YAML. */
export function blankLinesBeforeFirstSection(
  bodyStartLine: number,
  firstSectionStart: number,
  source = '',
): number {
  if (!source) {
    return Math.max(0, firstSectionStart - bodyStartLine);
  }
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  return lines
    .slice(bodyStartLine, firstSectionStart)
    .filter((line) => line.trim() === '')
    .length;
}

/** Counts Markdown blank-line runs while ignoring fenced-code contents. */
export function internalBlankLineRuns(markdown: string): number[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const runs: number[] = [];
  let fence: { marker: '`' | '~'; length: number } | null = null;
  let run = 0;

  const flush = (): void => {
    if (run > 0) {
      runs.push(run);
      run = 0;
    }
  };

  for (const line of lines) {
    const fenceMatch = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (fenceMatch) {
      const marker = fenceMatch[1]?.charAt(0);
      if (!fence && (marker === '`' || marker === '~')) {
        flush();
        fence = { marker, length: fenceMatch[1]?.length ?? 3 };
        continue;
      }
      const activeFence = fence;
      if (
        activeFence &&
        activeFence.marker === marker &&
        (fenceMatch[1]?.length ?? 0) >= activeFence.length
      ) {
        fence = null;
        continue;
      }
    }
    if (fence) {
      continue;
    }
    if (line.trim() === '') {
      run += 1;
    } else {
      flush();
    }
  }
  flush();

  // Leading/trailing newlines delimit the section rather than two children.
  if (lines[0]?.trim() === '') {
    runs.shift();
  }
  if (lines.at(-1)?.trim() === '') {
    runs.pop();
  }
  return runs;
}

export function createBlankLineSpacer(
  document: Document,
  count: number,
): HTMLDivElement {
  const spacer = document.createElement('div');
  spacer.className = 'templar-blank-line-spacer';
  spacer.dataset.templarOwned = 'true';
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.setProperty('--templar-blank-lines', String(Math.max(1, count)));
  return spacer;
}
