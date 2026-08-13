import type { FontMetrics, TemplarNoteStyle, ValidationIssue } from '../../types';

export interface PageMetricSet {
  body: FontMetrics;
  h1: FontMetrics;
  h2: FontMetrics;
  h3: FontMetrics;
  h4: FontMetrics;
  h5: FontMetrics;
  h6: FontMetrics;
  code: FontMetrics;
}

export interface StyleCompilation {
  css: string;
  issues: ValidationIssue[];
}

export interface StyleCompilerContext {
  style: TemplarNoteStyle;
  scope: string;
  scopeId: string;
  metrics: PageMetricSet;
  gridded: boolean;
  paged: boolean;
  unit: number;
  bodyLineHeight: number;
  blockSpacing: number;
  baselinePosition: number;
  pageGap: number;
  pageSpan: number;
  printableHeight: number;
  paddingLeft: string;
  paddingRight: string;
  paperPattern: string;
  codePadding: { top: number; bottom: number };
  bodyFont: string;
  paperColor: string;
  textColor: string;
  mutedColor: string;
  imageBorder: string;
  watermarkText: string;
}
