import type { PaperOriginTarget } from '../paper-origin';

export interface PaperOriginState {
  targets: Map<HTMLElement, PaperOriginTarget>;
  pageContents: Set<HTMLElement>;
}

export function clearPaperOriginState(state: PaperOriginState): void {
  for (const element of state.pageContents) {
    element.style.removeProperty('--templar-paper-baseline-position');
  }
  state.targets.clear();
  state.pageContents.clear();
}
