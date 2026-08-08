export type BaselineMode = 'strict' | 'balanced' | 'free';
export type PaperPattern = 'blank' | 'ruled' | 'dot-grid' | 'graph';
export type PageMode = 'pageless' | 'paged';
export type PageSize = 'a4' | 'letter' | 'custom';
export type ImageFrame =
  | 'none'
  | 'thin'
  | 'photo'
  | 'polaroid'
  | 'scrapbook'
  | 'rounded'
  | 'technical'
  | 'dark'
  | 'vintage';

export interface TemplateMetadata {
  author: string;
  description: string;
  tags: string[];
}

export interface PaperStyle {
  color: string;
  pattern: PaperPattern;
  patternColor: string;
  majorPatternColor: string;
  marginLine: boolean;
  marginColor: string;
  marginOffset: number;
}

export interface BaselineStyle {
  enabled: boolean;
  mode: BaselineMode;
  unit: number;
  snapImages: boolean;
}

export interface TypographyStyle {
  bodyFont: string;
  bodySize: number;
  bodyWeight: number;
  textColor: string;
  mutedColor: string;
}

export interface HeadingLevelStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  decoration: 'none' | 'underline' | 'rule' | 'highlight';
}

export interface HeadingStyle {
  h1: HeadingLevelStyle;
  h2: HeadingLevelStyle;
  h3: HeadingLevelStyle;
  h4: HeadingLevelStyle;
}

export interface LayoutStyle {
  maxWidth: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  pageRadius: number;
  pageShadow: string;
}

export interface ImageStyle {
  frame: ImageFrame;
  borderWidth: number;
  borderColor: string;
  bottomBorderWidth: number;
  cornerRadius: number;
  rotation: number;
  shadow: string;
  maxWidth: number;
  topSpacing: number;
  bottomSpacing: number;
  opacity: number;
  sepia: number;
  grayscale: number;
  saturation: number;
  contrast: number;
}

export interface BlockStyle {
  linkColor: string;
  highlightBackground: string;
  highlightTextColor: string;
  quoteAccent: string;
  quoteBackground: string;
  quoteTextColor: string;
  codeBackground: string;
  codeTextColor: string;
  codeFont: string;
  codeSize: number;
  tableBorder: string;
  tableHeaderBackground: string;
  checkboxAccent: string;
}

export interface TemplarTemplate {
  version: 1;
  id: string;
  name: string;
  metadata: TemplateMetadata;
  paper: PaperStyle;
  baseline: BaselineStyle;
  typography: TypographyStyle;
  headings: HeadingStyle;
  layout: LayoutStyle;
  images: ImageStyle;
  blocks: BlockStyle;
  css: string;
  builtIn?: boolean;
}

export interface NotePageOptions {
  mode: PageMode;
  size: PageSize;
  width: number;
  height: number;
  gap: number;
  scaleToFit: boolean;
}

export interface AttachmentOverride {
  frame?: ImageFrame;
  rotation?: number;
  width?: number;
}

export interface TemplarNoteStyle extends TemplarTemplate {
  sourceTemplateId?: string;
  attachments?: Record<string, AttachmentOverride>;
  page: NotePageOptions;
}

export interface TemplarSettings {
  enableReadingView: boolean;
  enableLivePreview: boolean;
  hideStyleMetadata: boolean;
  defaultTemplateId: string;
  defaultGridUnit: number;
  fontCacheSize: number;
  userTemplates: TemplarTemplate[];
}

export type ValidationSeverity = 'error' | 'warning' | 'suggestion';

export interface ValidationIssue {
  severity: ValidationSeverity;
  path: string;
  message: string;
  fix?: string;
}

export interface ValidationResult {
  valid: boolean;
  issues: ValidationIssue[];
}

export interface FontMetricRequest {
  family: string;
  fontSize: number;
  fontWeight: number;
  lineHeight: number;
}

export interface FontMetrics {
  baseline: number;
  ascent: number;
  descent: number;
  lineHeight: number;
  measuredAt: number;
}

export interface CompiledPageStyle {
  css: string;
  issues: ValidationIssue[];
}
