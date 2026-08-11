export interface ReadingWhitespaceOwner {
  readonly root: HTMLElement;
  readonly sections: HTMLElement[];
}

export function removeOwnedWhitespace(owner: ReadingWhitespaceOwner): void {
  for (const section of owner.sections) {
    section.querySelectorAll('.templar-blank-line-spacer').forEach((spacer) => spacer.remove());
    section.removeClass('templar-reading-section');
  }
}
