export interface ReadingSectionRange {
  lineStart: number;
  lineEnd: number;
  text: string;
}

export function blankLinesBetweenSections(
  previousLineEnd: number,
  nextLineStart: number,
): number {
  return Math.max(0, nextLineStart - previousLineEnd - 1);
}

/** Counts Markdown blank-line runs while ignoring fenced-code contents. */
export function internalBlankLineRuns(markdown: string): number[] {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n');
  const runs: number[] = [];
  let fence: '`' | '~' | null = null;
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
        fence = marker;
        continue;
      }
      if (fence === marker) {
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
