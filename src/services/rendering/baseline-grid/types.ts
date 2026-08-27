import type { FontMetrics, TemplarNoteStyle } from '../../../types';
import type { PageMetricSet } from '../../style-compiler';
import type { GridLattice } from './math';

export type BaselineView = 'reading' | 'live-preview';

export type RhythmKind =
  | 'text'
  | 'heading'
  | 'list'
  | 'code'
  | 'composite'
  | 'atomic'
  | 'image'
  | 'editor-line'
  | 'editor-widget'
  | 'blank-space'
  | 'non-rhythmic-ui';

export interface RhythmMeasurement {
  element: HTMLElement;
  kind: RhythmKind;
  top: number;
  bottom: number;
  firstBaseline?: number;
  lastBaseline?: number;
  marginBefore: number;
  marginAfter: number;
  existingBeforeCorrection: number;
  existingAfterCorrection: number;
  pageIndex: number;
  flowIndex: number;
  intentional: boolean;
}

export type RhythmCorrectionReason =
  | 'baseline'
  | 'block-exit'
  | 'page-entry'
  | 'widget-exit'
  | 'prefix-exit';

export interface RhythmCorrection {
  before: number;
  after: number;
  reason: RhythmCorrectionReason;
}

export interface BaselineGridStats {
  measurementPasses: number;
  writePasses: number;
  nodesMeasured: number;
  nodesCorrected: number;
  fullScans: number;
  dirtyScans: number;
  resizeObserverCallbacks: number;
  mutationObserverCallbacks: number;
  rafCallbacks: number;
  nonConvergedElements: string[];
}

export interface BaselineGridRootState {
  pageContent: HTMLElement;
  view: BaselineView;
  lattice: GridLattice;
  metrics: PageMetricSet;
  style: TemplarNoteStyle;
  flowItems: HTMLElement[];
  measurements: Map<HTMLElement, RhythmMeasurement>;
  corrections: Map<HTMLElement, RhythmCorrection>;
}

export interface BaselineGridConfiguration {
  contentEl: HTMLElement;
  style: TemplarNoteStyle;
  metrics: PageMetricSet;
}

export interface BaselineGridDebugPoint {
  x: number;
  y: number;
  kind: 'grid' | 'baseline' | 'entry' | 'exit' | 'failure';
  id: string;
  error?: number;
}

export interface BaselineGridDebugSnapshot {
  root: HTMLElement;
  unit: number;
  origin: number;
  points: BaselineGridDebugPoint[];
}

export type RhythmMetric = FontMetrics;
