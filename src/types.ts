export type BaselineMode = 'strict' | 'balanced' | 'free';
export type PaperPattern =
  | 'blank'
  | 'ruled'
  | 'dot-grid'
  | 'graph'
  | 'ledger'
  | 'cross-hatch'
  | 'diagonal'
  | 'hex'
  | 'scallop';
export type PageMode = 'pageless' | 'paged';
export type PageSize = 'a4' | 'letter' | 'custom';
export type DefaultPageFlow = 'pageless' | 'paged-a4' | 'paged-letter';
export type RulePageFlow = 'default' | DefaultPageFlow;
export type LibraryDensity = 'compact' | 'comfortable' | 'gallery';
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
export type ImageFloat = 'none' | 'left' | 'right';
export type ImageObjectFit = 'contain' | 'cover' | 'fill' | 'scale-down';
export type DividerStyle = 'solid' | 'dashed' | 'dotted' | 'double' | 'fade';
export type ListMarkerStyle = 'disc' | 'circle' | 'square' | 'none';
export type HeadingTextTransform = 'none' | 'uppercase' | 'lowercase' | 'capitalize';

export interface TemplateMetadata {
  author: string;
  description: string;
  folder: string;
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
  patternOpacity: number;
  patternScale: number;
  dotRadius: number;
  graphMajorInterval: number;
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
  bodyLineHeight: number;
  firstLineIndent: number;
  dropCap: boolean;
}

export interface HeadingLevelStyle {
  font: string;
  size: number;
  weight: number;
  color: string;
  decoration: 'none' | 'underline' | 'rule' | 'highlight';
  letterSpacing: number;
  textTransform: HeadingTextTransform;
}

export interface HeadingStyle {
  h1: HeadingLevelStyle;
  h2: HeadingLevelStyle;
  h3: HeadingLevelStyle;
  h4: HeadingLevelStyle;
  h5: HeadingLevelStyle;
  h6: HeadingLevelStyle;
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
  float: ImageFloat;
  objectFit: ImageObjectFit;
  duotone: string;
}

export interface CalloutVariant {
  accent?: string;
  background?: string;
  textColor?: string;
  titleColor?: string;
  iconColor?: string;
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
  tableBorderWidth: number;
  tableFontSize: number;
  tableTextColor: string;
  tableHeaderTextColor: string;
  tablePadding: number;
  tableStriped: boolean;
  tableStripeColor: string;
  checkboxAccent: string;
  dividerColor: string;
  dividerWidth: number;
  dividerStyle: DividerStyle;
  calloutAccent: string;
  calloutBackground: string;
  calloutTextColor: string;
  calloutTitleColor: string;
  calloutIconColor: string;
  calloutBorderWidth: number;
  calloutRadius: number;
  calloutVariants: Record<string, CalloutVariant>;
  embedBackground: string;
  embedAccent: string;
  embedRadius: number;
}

export interface ListsStyle {
  markerStyle: ListMarkerStyle;
  markerColor: string;
  indentGuides: boolean;
  indentGuideColor: string;
  nestedIndent: number;
}

export interface WatermarkStyle {
  text: string;
  color: string;
  size: number;
  rotation: number;
  opacity: number;
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
  lists: ListsStyle;
  layout: LayoutStyle;
  images: ImageStyle;
  blocks: BlockStyle;
  watermark: WatermarkStyle;
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
  provenance?: NoteStyleProvenance;
  attachments?: Record<string, AttachmentOverride>;
  page: NotePageOptions;
}

export interface NoteStyleProvenance {
  sourceSnapshot?: TemplarTemplate;
  appliedByRule?: {
    id: string;
    name: string;
  };
}

export type FilenameRuleOperator = 'starts-with' | 'ends-with' | 'contains' | 'exact';

export type StyleRuleCondition =
  | { type: 'folder'; folder: string; includeSubfolders: boolean }
  | { type: 'tag'; tag: string }
  | { type: 'filename'; operator: FilenameRuleOperator; value: string }
  | { type: 'frontmatter'; property: string; value: string };

export interface StyleRule {
  id: string;
  name: string;
  enabled: boolean;
  conditions: StyleRuleCondition[];
  templateId: string;
  pageFlow: RulePageFlow;
}

export interface TemplarPack {
  version: 1;
  name: string;
  description: string;
  author: string;
  tags: string[];
  templates: TemplarTemplate[];
}

export interface TemplarSettings {
  enableReadingView: boolean;
  enableLivePreview: boolean;
  hideStyleMetadata: boolean;
  defaultTemplateId: string;
  defaultGridUnit: number;
  fontCacheSize: number;
  favouriteTemplateIds: string[];
  recentTemplateIds: string[];
  defaultNewPageFlow: DefaultPageFlow;
  libraryDensity: LibraryDensity;
  styleRules: StyleRule[];
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
