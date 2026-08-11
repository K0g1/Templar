import type {
  ImageFrame,
  PaperPattern,
  TemplarTemplate,
} from '../../types';
import { clone } from '../../utils/value';
import { ensureReadableTemplate, readableColor } from '../accessibility';
import { DEFAULT_TEMPLATE } from '../defaults';

type VisualMood =
  | 'clean'
  | 'editorial'
  | 'literary'
  | 'playful'
  | 'technical'
  | 'dramatic';

type LayoutMood = 'airy' | 'compact' | 'soft' | 'wide';

interface TemplateSeed {
  id: string;
  name: string;
  description: string;
  tags: readonly string[];
  paper: string;
  line: string;
  text: string;
  muted: string;
  accent: string;
  highlight: string;
  highlightText: string;
  pattern: PaperPattern;
  font: string;
  headingFont?: string;
  frame: ImageFrame;
  mood: VisualMood;
  layout?: LayoutMood;
  major?: string;
  margin?: string;
  unit?: number;
  watermark?: string;
}

interface PackDefinition {
  folder: string;
  tags: readonly string[];
  templates: readonly TemplateSeed[];
}

const serif = 'Georgia, "Times New Roman", serif';
const literarySerif = 'Baskerville, "Iowan Old Style", Georgia, serif';
const modern = 'Inter, system-ui, -apple-system, sans-serif';
const rounded = 'Nunito, "Avenir Next", system-ui, sans-serif';
const humanist = '"Avenir Next", Avenir, system-ui, sans-serif';
const mono = '"SFMono-Regular", Consolas, "Liberation Mono", monospace';
const technical = '"IBM Plex Mono", "Courier New", monospace';
const editorial = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const geometric = 'Futura, "Avenir Next", system-ui, sans-serif';

const moodCss: Readonly<Record<VisualMood, string>> = {
  clean: `.page h1 { letter-spacing: -0.04em; }
.page hr { opacity: 0.55; }`,
  editorial: `.page h1 { text-transform: uppercase; letter-spacing: 0.055em; }
.page h2 { letter-spacing: 0.025em; }`,
  literary: `.page blockquote { font-style: italic; }
.page h1 { letter-spacing: 0.012em; }`,
  playful: `.page h1 { letter-spacing: -0.025em; }
.page blockquote { border-radius: 10px; }`,
  technical: `.page h1, .page h2 { text-transform: uppercase; letter-spacing: 0.07em; }
.page table { font-variant-numeric: tabular-nums; }`,
  dramatic: `.page h1 { text-transform: uppercase; letter-spacing: 0.09em; }
.page hr { opacity: 0.8; }`,
};

function createPackedTemplate(
  pack: PackDefinition,
  seed: TemplateSeed,
  index: number,
): TemplarTemplate {
  const template = clone(DEFAULT_TEMPLATE);
  const bodyColor = readableColor(seed.text, seed.paper);
  const linkColor = readableColor(seed.accent, seed.paper);
  const highlightText = readableColor(seed.highlightText, seed.highlight, seed.paper);
  template.id = seed.id;
  template.name = seed.name;
  template.builtIn = true;
  template.metadata.author = 'Templar';
  template.metadata.description = seed.description;
  template.metadata.tags = [...new Set([...pack.tags, ...seed.tags])];
  Object.assign(template.metadata, { folder: pack.folder });

  template.paper.color = seed.paper;
  template.paper.pattern = seed.pattern;
  template.paper.patternColor = seed.line;
  template.paper.majorPatternColor = seed.major ?? seed.accent;
  template.paper.marginLine = seed.margin !== undefined;
  template.paper.marginColor = seed.margin ?? seed.accent;
  template.paper.patternOpacity = seed.pattern === 'blank' ? 0 : 0.82;
  template.paper.patternScale = seed.pattern === 'scallop' ? 1.35 : seed.pattern === 'hex' ? 1.18 : 1;
  template.paper.dotRadius = index % 3 === 0 ? 1.25 : 1;
  template.paper.graphMajorInterval = index % 2 === 0 ? 5 : 4;

  template.baseline.enabled = seed.pattern !== 'blank';
  template.baseline.mode = seed.pattern === 'blank' ? 'free' : 'balanced';
  template.baseline.unit = seed.unit ?? (seed.pattern === 'graph' ? 24 : 28 + (index % 3));
  template.baseline.snapImages = seed.pattern !== 'blank';

  template.typography.bodyFont = seed.font;
  template.typography.bodySize = seed.mood === 'technical' ? 15 : seed.mood === 'literary' ? 18 : 16;
  template.typography.bodyWeight = seed.mood === 'dramatic' ? 450 : 400;
  template.typography.textColor = bodyColor;
  template.typography.mutedColor = seed.muted;
  template.typography.firstLineIndent = seed.mood === 'literary' ? 24 : 0;
  template.typography.dropCap = seed.mood === 'literary' && index % 2 === 0;

  const headingFont = seed.headingFont ?? seed.font;
  const levels = ['h1', 'h2', 'h3', 'h4', 'h5', 'h6'] as const;
  for (const [headingIndex, level] of levels.entries()) {
    const heading = template.headings[level];
    heading.font = headingFont;
    heading.color = headingIndex < 2 ? linkColor : bodyColor;
    heading.letterSpacing = seed.mood === 'technical' ? 1.2 : seed.mood === 'dramatic' ? 1.6 : 0;
    heading.textTransform = seed.mood === 'technical' || seed.mood === 'dramatic' ? 'uppercase' : 'none';
  }
  template.headings.h1.decoration = index % 4 === 1 ? 'rule' : index % 4 === 2 ? 'highlight' : 'none';
  template.headings.h2.decoration = index % 4 === 3 ? 'underline' : 'none';

  template.lists.markerStyle = index % 4 === 1 ? 'circle' : index % 4 === 2 ? 'square' : 'disc';
  template.lists.markerColor = seed.accent;
  template.lists.indentGuides = seed.mood === 'technical' || index % 3 === 0;
  template.lists.indentGuideColor = seed.line;
  template.lists.nestedIndent = seed.mood === 'technical' ? 28 : 32;

  const layout = seed.layout ?? 'soft';
  template.layout.maxWidth = layout === 'wide' ? 980 : layout === 'compact' ? 680 : layout === 'airy' ? 740 : 820;
  template.layout.paddingTop = layout === 'compact' ? 48 : 64;
  template.layout.paddingRight = layout === 'airy' ? 88 : 72;
  template.layout.paddingBottom = layout === 'compact' ? 92 : 120;
  template.layout.paddingLeft = seed.margin ? 102 : layout === 'airy' ? 88 : 72;
  template.layout.pageRadius = layout === 'soft' ? 16 : layout === 'airy' ? 8 : 2;
  template.layout.pageShadow = seed.mood === 'dramatic'
    ? '0 18px 48px rgba(0, 0, 0, 0.38)'
    : '0 12px 34px rgba(31, 37, 43, 0.14)';

  template.images.frame = seed.frame;
  template.images.borderWidth = seed.frame === 'none' ? 0 : seed.frame === 'polaroid' ? 9 : 2 + (index % 3);
  template.images.bottomBorderWidth = seed.frame === 'polaroid' ? 32 : template.images.borderWidth;
  template.images.borderColor = seed.accent;
  template.images.cornerRadius = seed.frame === 'rounded' ? 14 : seed.frame === 'technical' ? 2 : 5;
  template.images.rotation = seed.frame === 'scrapbook' || seed.frame === 'polaroid' ? (index % 5) - 2 : 0;
  template.images.shadow = seed.frame === 'none' ? 'none' : '0 9px 24px rgba(20, 25, 30, 0.22)';
  template.images.sepia = seed.frame === 'vintage' ? 0.22 : 0;
  template.images.grayscale = seed.mood === 'editorial' && index % 2 === 0 ? 0.16 : 0;
  template.images.saturation = seed.mood === 'playful' ? 1.12 : 1;
  template.images.contrast = seed.mood === 'dramatic' ? 1.08 : 1;

  template.blocks.linkColor = linkColor;
  template.blocks.highlightBackground = seed.highlight;
  template.blocks.highlightTextColor = highlightText;
  template.blocks.quoteAccent = seed.accent;
  template.blocks.quoteBackground = seed.line;
  template.blocks.quoteTextColor = bodyColor;
  template.blocks.codeBackground = seed.mood === 'dramatic' ? 'rgba(0, 0, 0, 0.28)' : seed.line;
  template.blocks.codeTextColor = bodyColor;
  template.blocks.tableBorder = seed.line;
  template.blocks.tableHeaderBackground = seed.highlight;
  template.blocks.tableTextColor = bodyColor;
  template.blocks.tableHeaderTextColor = highlightText;
  template.blocks.tableStriped = index % 2 === 0;
  template.blocks.tableStripeColor = seed.line;
  template.blocks.checkboxAccent = seed.accent;
  template.blocks.dividerColor = seed.accent;
  template.blocks.dividerStyle = index % 4 === 0 ? 'fade' : index % 4 === 1 ? 'dashed' : index % 4 === 2 ? 'double' : 'solid';
  template.blocks.calloutAccent = seed.accent;
  template.blocks.calloutBackground = seed.line;
  template.blocks.calloutTextColor = bodyColor;
  template.blocks.calloutTitleColor = seed.accent;
  template.blocks.calloutIconColor = seed.accent;
  template.blocks.calloutRadius = seed.mood === 'playful' ? 14 : 6;
  template.blocks.embedBackground = seed.line;
  template.blocks.embedAccent = seed.accent;
  template.blocks.embedRadius = seed.mood === 'playful' ? 14 : 6;

  template.watermark.text = seed.watermark ?? '';
  template.watermark.color = seed.accent;
  template.watermark.opacity = seed.watermark ? 0.07 : 0.05;
  template.watermark.rotation = seed.mood === 'dramatic' ? -18 : -12;
  template.css = moodCss[seed.mood];
  return ensureReadableTemplate(template);
}

const PACKS: readonly PackDefinition[] = [
  {
    folder: 'Essentials',
    tags: ['essentials', 'everyday'],
    templates: [
      { id: 'clean-slate', name: 'Clean Slate', description: 'A distraction-free white canvas for clear everyday notes.', tags: ['minimal', 'blank'], paper: '#ffffff', line: 'rgba(67, 76, 86, 0.14)', text: '#252a2e', muted: '#707981', accent: '#3f6f91', highlight: 'rgba(144, 195, 225, 0.36)', highlightText: '#183247', pattern: 'blank', font: modern, frame: 'rounded', mood: 'clean', layout: 'airy' },
      { id: 'daily-ruled', name: 'Daily Ruled', description: 'A familiar blue-rule notebook for daily writing and quick capture.', tags: ['daily', 'ruled'], paper: '#fffef8', line: 'rgba(74, 139, 184, 0.28)', text: '#30343a', muted: '#747b82', accent: '#3f78a0', highlight: 'rgba(252, 220, 86, 0.48)', highlightText: '#3a321b', pattern: 'ruled', font: humanist, frame: 'photo', mood: 'clean', margin: 'rgba(214, 89, 89, 0.48)' },
      { id: 'focus-dots', name: 'Focus Dots', description: 'Crisp dot-grid paper tuned for lists, tasks, and focused planning.', tags: ['planning', 'dot-grid'], paper: '#fafaf6', line: 'rgba(71, 91, 98, 0.26)', text: '#293438', muted: '#6b787c', accent: '#3b756d', highlight: 'rgba(139, 195, 164, 0.4)', highlightText: '#1e3c35', pattern: 'dot-grid', font: modern, frame: 'thin', mood: 'clean' },
      { id: 'project-graph', name: 'Project Graph', description: 'Balanced graph paper for diagrams, estimates, and project thinking.', tags: ['projects', 'graph'], paper: '#f7faf9', line: 'rgba(60, 133, 119, 0.19)', major: 'rgba(43, 105, 96, 0.34)', text: '#243a37', muted: '#677d79', accent: '#2e786e', highlight: 'rgba(110, 193, 173, 0.35)', highlightText: '#173d37', pattern: 'graph', font: modern, headingFont: technical, frame: 'technical', mood: 'technical' },
      { id: 'meeting-ledger', name: 'Meeting Ledger', description: 'A tidy column-friendly ledger for agendas, decisions, and owners.', tags: ['meetings', 'ledger'], paper: '#fbfaf5', line: 'rgba(74, 88, 121, 0.2)', major: 'rgba(74, 88, 121, 0.34)', text: '#2f3440', muted: '#737987', accent: '#4b5e91', highlight: 'rgba(153, 170, 220, 0.36)', highlightText: '#252f50', pattern: 'ledger', font: editorial, headingFont: geometric, frame: 'thin', mood: 'editorial', layout: 'wide' },
      { id: 'reading-notes', name: 'Reading Notes', description: 'Bookish cream paper for excerpts, reactions, and reading lists.', tags: ['reading', 'books'], paper: '#f8f3e7', line: 'rgba(112, 87, 55, 0.18)', text: '#43382c', muted: '#796d5e', accent: '#815437', highlight: 'rgba(219, 180, 104, 0.36)', highlightText: '#382819', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary', margin: 'rgba(129, 84, 55, 0.38)' },
      { id: 'idea-canvas', name: 'Idea Canvas', description: 'An open, wide page for sketches, loose thoughts, and connections.', tags: ['ideas', 'creative'], paper: '#fdfcf8', line: 'rgba(75, 90, 101, 0.13)', text: '#2f3539', muted: '#747d82', accent: '#b15e3e', highlight: 'rgba(241, 177, 111, 0.38)', highlightText: '#4a2d20', pattern: 'blank', font: humanist, frame: 'scrapbook', mood: 'playful', layout: 'wide' },
      { id: 'checklist-desk', name: 'Checklist Desk', description: 'Structured cross-hatch paper that keeps checklists calm and legible.', tags: ['checklist', 'tasks'], paper: '#f8faf7', line: 'rgba(74, 109, 83, 0.16)', text: '#29372d', muted: '#6a766c', accent: '#4f7e5b', highlight: 'rgba(171, 205, 153, 0.42)', highlightText: '#294125', pattern: 'cross-hatch', font: modern, frame: 'rounded', mood: 'clean', layout: 'compact' },
    ],
  },
  {
    folder: 'Color Stories',
    tags: ['color-story', 'palette'],
    templates: [
      { id: 'terracotta-teal', name: 'Terracotta & Teal', description: 'Sun-baked terracotta balanced by cool, confident teal.', tags: ['terracotta', 'teal'], paper: '#f7eadf', line: 'rgba(44, 113, 110, 0.18)', text: '#4a342d', muted: '#826c64', accent: '#277873', highlight: 'rgba(211, 116, 78, 0.38)', highlightText: '#48271c', pattern: 'scallop', font: humanist, headingFont: serif, frame: 'rounded', mood: 'playful' },
      { id: 'cobalt-citrus', name: 'Cobalt Citrus', description: 'Electric cobalt typography with a bright citrus highlight.', tags: ['cobalt', 'citrus'], paper: '#f8f9f2', line: 'rgba(34, 76, 168, 0.2)', text: '#26365e', muted: '#6d7896', accent: '#2452b6', highlight: 'rgba(228, 211, 48, 0.5)', highlightText: '#34310d', pattern: 'dot-grid', font: geometric, frame: 'thin', mood: 'editorial' },
      { id: 'plum-mustard', name: 'Plum & Mustard', description: 'Rich plum ink and warm mustard accents with editorial character.', tags: ['plum', 'mustard'], paper: '#f7f0e8', line: 'rgba(92, 48, 82, 0.18)', text: '#4b3046', muted: '#7d6879', accent: '#6c375f', highlight: 'rgba(211, 164, 48, 0.42)', highlightText: '#3b2e0c', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary' },
      { id: 'sage-clay', name: 'Sage & Clay', description: 'Grounded sage and soft clay for thoughtful, earthy notes.', tags: ['sage', 'clay'], paper: '#eef0e3', line: 'rgba(111, 130, 91, 0.2)', text: '#394137', muted: '#737b6e', accent: '#a45f49', highlight: 'rgba(162, 188, 135, 0.42)', highlightText: '#2f3d29', pattern: 'cross-hatch', font: serif, frame: 'scrapbook', mood: 'literary' },
      { id: 'rose-espresso', name: 'Rose & Espresso', description: 'Muted rose paper grounded by deep espresso-brown type.', tags: ['rose', 'espresso'], paper: '#f5e6e4', line: 'rgba(91, 57, 50, 0.16)', text: '#49322e', muted: '#806b67', accent: '#a4515d', highlight: 'rgba(220, 139, 147, 0.36)', highlightText: '#47252b', pattern: 'blank', font: editorial, headingFont: literarySerif, frame: 'photo', mood: 'editorial', layout: 'airy' },
      { id: 'glacier-ember', name: 'Glacier & Ember', description: 'Icy blue structure animated by a small ember-orange spark.', tags: ['glacier', 'ember'], paper: '#edf7fa', line: 'rgba(62, 135, 161, 0.2)', text: '#28434d', muted: '#6b8690', accent: '#dd6843', highlight: 'rgba(116, 197, 220, 0.4)', highlightText: '#203b44', pattern: 'hex', font: modern, frame: 'technical', mood: 'technical' },
      { id: 'aubergine-mint', name: 'Aubergine & Mint', description: 'Velvety aubergine paired with a fresh mint glow.', tags: ['aubergine', 'mint'], paper: '#2b2130', line: 'rgba(157, 232, 196, 0.15)', text: '#f2eaf4', muted: '#b9aabd', accent: '#9de8c4', highlight: 'rgba(173, 90, 146, 0.54)', highlightText: '#fff5fb', pattern: 'dot-grid', font: modern, headingFont: geometric, frame: 'dark', mood: 'dramatic' },
      { id: 'indigo-saffron', name: 'Indigo & Saffron', description: 'Deep indigo lines with luminous saffron highlights.', tags: ['indigo', 'saffron'], paper: '#f5f2e8', line: 'rgba(51, 57, 121, 0.19)', text: '#303258', muted: '#71738f', accent: '#3b418b', highlight: 'rgba(226, 170, 33, 0.46)', highlightText: '#3b2c08', pattern: 'diagonal', font: humanist, headingFont: geometric, frame: 'rounded', mood: 'editorial' },
    ],
  },
  {
    folder: 'Seasons',
    tags: ['seasonal', 'atmosphere'],
    templates: [
      { id: 'spring-meadow', name: 'Spring Meadow', description: 'New-leaf greens and flower-petal pink on fresh cream.', tags: ['spring', 'meadow'], paper: '#f7fae9', line: 'rgba(102, 153, 91, 0.2)', text: '#354936', muted: '#718173', accent: '#db7590', highlight: 'rgba(178, 218, 128, 0.42)', highlightText: '#31451f', pattern: 'scallop', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'summer-solstice', name: 'Summer Solstice', description: 'Sunlit yellow and clear-sky blue for energetic summer plans.', tags: ['summer', 'sunshine'], paper: '#fff8d8', line: 'rgba(49, 145, 190, 0.2)', text: '#304853', muted: '#71868e', accent: '#248db6', highlight: 'rgba(247, 182, 45, 0.48)', highlightText: '#46300a', pattern: 'dot-grid', font: humanist, frame: 'photo', mood: 'playful', watermark: '☀' },
      { id: 'autumn-harvest', name: 'Autumn Harvest', description: 'Burnished pumpkin, wheat, and chestnut for crisp autumn days.', tags: ['autumn', 'harvest'], paper: '#f3e4c8', line: 'rgba(126, 74, 40, 0.18)', text: '#493527', muted: '#7d6855', accent: '#a64d2c', highlight: 'rgba(211, 151, 57, 0.42)', highlightText: '#422b13', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary', margin: 'rgba(155, 71, 46, 0.42)' },
      { id: 'winter-frost', name: 'Winter Frost', description: 'Pale blue geometry and charcoal type with a quiet wintry hush.', tags: ['winter', 'frost'], paper: '#f3f8fb', line: 'rgba(109, 158, 187, 0.2)', text: '#34454f', muted: '#768994', accent: '#527e9a', highlight: 'rgba(188, 220, 235, 0.5)', highlightText: '#294453', pattern: 'hex', font: modern, frame: 'thin', mood: 'clean', layout: 'airy' },
      { id: 'rainy-day', name: 'Rainy Day', description: 'Blue-gray ruling and inky accents for reflective rainy afternoons.', tags: ['rain', 'cozy'], paper: '#eaf0f1', line: 'rgba(80, 118, 134, 0.24)', text: '#31434b', muted: '#718188', accent: '#466f83', highlight: 'rgba(130, 172, 190, 0.42)', highlightText: '#223b46', pattern: 'ruled', font: serif, frame: 'photo', mood: 'literary' },
      { id: 'golden-hour', name: 'Golden Hour', description: 'Warm apricot light and dusky violet for end-of-day reflections.', tags: ['sunset', 'golden-hour'], paper: '#fff0dc', line: 'rgba(114, 74, 115, 0.17)', text: '#50394d', muted: '#836f80', accent: '#8b527b', highlight: 'rgba(239, 163, 74, 0.44)', highlightText: '#4b2c0f', pattern: 'diagonal', font: humanist, frame: 'polaroid', mood: 'playful' },
      { id: 'first-snow', name: 'First Snow', description: 'A nearly white page with fine silver dots and evergreen details.', tags: ['snow', 'evergreen'], paper: '#fbfcfc', line: 'rgba(128, 145, 150, 0.22)', text: '#303b3d', muted: '#778386', accent: '#3f7167', highlight: 'rgba(190, 218, 213, 0.42)', highlightText: '#27423d', pattern: 'dot-grid', font: editorial, headingFont: serif, frame: 'rounded', mood: 'clean' },
      { id: 'monsoon-garden', name: 'Monsoon Garden', description: 'Saturated leaf green and rainwater blue on moody garden paper.', tags: ['monsoon', 'garden'], paper: '#172c2a', line: 'rgba(90, 181, 172, 0.17)', text: '#e4f1eb', muted: '#9bb9af', accent: '#75c7b4', highlight: 'rgba(94, 143, 87, 0.58)', highlightText: '#f2fff7', pattern: 'cross-hatch', font: serif, headingFont: geometric, frame: 'dark', mood: 'dramatic' },
    ],
  },
  {
    folder: 'Celebrations & Occasions',
    tags: ['celebration', 'occasion'],
    templates: [
      { id: 'birthday-confetti', name: 'Birthday Confetti', description: 'A colorful, buoyant page for birthday plans and memories.', tags: ['birthday', 'confetti'], paper: '#fff8fb', line: 'rgba(75, 165, 195, 0.2)', text: '#413542', muted: '#7d7080', accent: '#e34891', highlight: 'rgba(255, 209, 56, 0.52)', highlightText: '#42340a', pattern: 'scallop', font: rounded, frame: 'polaroid', mood: 'playful', watermark: '✦' },
      { id: 'wedding-vows', name: 'Wedding Vows', description: 'Elegant ivory and dusty rose for vows, toasts, and keepsakes.', tags: ['wedding', 'romantic'], paper: '#fdf9f2', line: 'rgba(174, 122, 128, 0.16)', text: '#4b3c3b', muted: '#837573', accent: '#aa6f78', highlight: 'rgba(226, 190, 178, 0.44)', highlightText: '#4a3232', pattern: 'blank', font: literarySerif, frame: 'photo', mood: 'literary', layout: 'airy' },
      { id: 'baby-shower', name: 'Baby Shower', description: 'Soft mint, peach, and cloud-like curves for joyful planning.', tags: ['baby-shower', 'soft'], paper: '#f6fcf7', line: 'rgba(100, 175, 156, 0.19)', text: '#3a4a45', muted: '#74847e', accent: '#e79779', highlight: 'rgba(183, 226, 208, 0.46)', highlightText: '#2b443a', pattern: 'scallop', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'graduation-day', name: 'Graduation Day', description: 'Confident navy and gold for speeches, goals, and milestones.', tags: ['graduation', 'milestone'], paper: '#f8f5ea', line: 'rgba(36, 58, 103, 0.2)', text: '#29354e', muted: '#6b7485', accent: '#a77a21', highlight: 'rgba(223, 187, 88, 0.43)', highlightText: '#3a2b0c', pattern: 'ruled', font: serif, headingFont: geometric, frame: 'thin', mood: 'editorial', margin: 'rgba(167, 122, 33, 0.42)' },
      { id: 'holiday-cheer', name: 'Holiday Cheer', description: 'Evergreen and cranberry details on warm festive stationery.', tags: ['holiday', 'festive'], paper: '#f8f3e8', line: 'rgba(55, 113, 76, 0.18)', text: '#374139', muted: '#747e76', accent: '#9d3f48', highlight: 'rgba(198, 164, 74, 0.4)', highlightText: '#3a2f12', pattern: 'cross-hatch', font: serif, frame: 'scrapbook', mood: 'literary', watermark: '✧' },
      { id: 'new-year-sparkle', name: 'New Year Sparkle', description: 'Midnight blue and champagne gold for resolutions and countdowns.', tags: ['new-year', 'sparkle'], paper: '#161b2b', line: 'rgba(214, 188, 117, 0.17)', text: '#f1ecdf', muted: '#aaa594', accent: '#d6bc75', highlight: 'rgba(103, 128, 201, 0.52)', highlightText: '#f8f5ea', pattern: 'dot-grid', font: geometric, frame: 'dark', mood: 'dramatic', watermark: '✦' },
      { id: 'dinner-party', name: 'Dinner Party', description: 'Sophisticated aubergine and olive for menus and hosting notes.', tags: ['dinner', 'hosting'], paper: '#f3eadf', line: 'rgba(93, 91, 59, 0.18)', text: '#493b42', muted: '#7c7075', accent: '#6f3d59', highlight: 'rgba(166, 164, 91, 0.42)', highlightText: '#333315', pattern: 'ledger', font: editorial, headingFont: literarySerif, frame: 'photo', mood: 'editorial' },
      { id: 'thank-you-note', name: 'Thank You Note', description: 'Graceful blue-gray stationery for sincere letters of thanks.', tags: ['gratitude', 'letter'], paper: '#f8faf8', line: 'rgba(93, 123, 137, 0.19)', text: '#39464b', muted: '#748086', accent: '#597f8f', highlight: 'rgba(185, 210, 205, 0.42)', highlightText: '#2d4849', pattern: 'ruled', font: literarySerif, frame: 'rounded', mood: 'literary', margin: 'rgba(180, 116, 108, 0.35)' },
    ],
  },
  {
    folder: 'Academia',
    tags: ['academia', 'study'],
    templates: [
      { id: 'cornell-lecture', name: 'Cornell Lecture', description: 'Clear ruled notes with a strong cue column and study-friendly contrast.', tags: ['cornell', 'lecture'], paper: '#fffdf2', line: 'rgba(63, 120, 165, 0.24)', text: '#303941', muted: '#717d85', accent: '#346e99', highlight: 'rgba(247, 211, 80, 0.45)', highlightText: '#3d3414', pattern: 'ruled', font: modern, frame: 'thin', mood: 'clean', margin: 'rgba(208, 80, 79, 0.58)', layout: 'wide' },
      { id: 'literature-seminar', name: 'Literature Seminar', description: 'Bookish seminar paper for close reading and textual discussion.', tags: ['literature', 'seminar'], paper: '#f5eddd', line: 'rgba(107, 78, 52, 0.17)', text: '#46362a', muted: '#796959', accent: '#783f36', highlight: 'rgba(201, 155, 82, 0.36)', highlightText: '#3d2a17', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary' },
      { id: 'chemistry-lab', name: 'Chemistry Lab', description: 'Cool graph paper engineered for observations, formulas, and results.', tags: ['chemistry', 'lab'], paper: '#f1f9f8', line: 'rgba(39, 136, 145, 0.19)', major: 'rgba(26, 111, 122, 0.36)', text: '#234247', muted: '#648086', accent: '#167886', highlight: 'rgba(113, 204, 194, 0.38)', highlightText: '#16413f', pattern: 'graph', font: technical, frame: 'technical', mood: 'technical' },
      { id: 'mathematics-proof', name: 'Mathematics Proof', description: 'Precise monochrome grid paper for derivations and formal proofs.', tags: ['mathematics', 'proof'], paper: '#fbfbf8', line: 'rgba(46, 55, 64, 0.16)', major: 'rgba(46, 55, 64, 0.28)', text: '#22282d', muted: '#697177', accent: '#354d62', highlight: 'rgba(167, 188, 203, 0.38)', highlightText: '#233643', pattern: 'graph', font: technical, headingFont: serif, frame: 'technical', mood: 'technical', layout: 'wide' },
      { id: 'history-archive', name: 'History Archive', description: 'Archival buff paper for timelines, sources, and historical arguments.', tags: ['history', 'archive'], paper: '#eaddbd', line: 'rgba(107, 78, 45, 0.17)', text: '#493624', muted: '#7a654d', accent: '#7d4634', highlight: 'rgba(185, 137, 63, 0.36)', highlightText: '#3c2a16', pattern: 'ledger', font: literarySerif, frame: 'vintage', mood: 'literary' },
      { id: 'language-study', name: 'Language Study', description: 'Friendly divided paper for vocabulary, translations, and examples.', tags: ['language', 'vocabulary'], paper: '#fff9ef', line: 'rgba(78, 133, 165, 0.2)', text: '#35434a', muted: '#728087', accent: '#cf5e55', highlight: 'rgba(246, 198, 87, 0.44)', highlightText: '#453713', pattern: 'ledger', font: humanist, frame: 'rounded', mood: 'clean' },
      { id: 'thesis-draft', name: 'Thesis Draft', description: 'Calm editorial white space for long-form academic arguments.', tags: ['thesis', 'writing'], paper: '#fcfcfa', line: 'rgba(55, 65, 74, 0.13)', text: '#252b30', muted: '#6d757b', accent: '#394f61', highlight: 'rgba(190, 200, 207, 0.4)', highlightText: '#273640', pattern: 'blank', font: serif, headingFont: editorial, frame: 'thin', mood: 'editorial', layout: 'airy' },
      { id: 'research-index', name: 'Research Index', description: 'Index-card-inspired structure for sources, claims, and cross-references.', tags: ['research', 'index'], paper: '#f9f5e8', line: 'rgba(62, 105, 139, 0.21)', text: '#313d46', muted: '#6d7981', accent: '#3d739a', highlight: 'rgba(225, 184, 88, 0.42)', highlightText: '#3c3012', pattern: 'cross-hatch', font: mono, frame: 'photo', mood: 'technical', layout: 'compact' },
    ],
  },
  {
    folder: 'Professional',
    tags: ['professional', 'work'],
    templates: [
      { id: 'executive-brief', name: 'Executive Brief', description: 'A restrained navy brief for decisions, summaries, and key metrics.', tags: ['executive', 'brief'], paper: '#f8f9fa', line: 'rgba(45, 63, 84, 0.16)', text: '#26313e', muted: '#697581', accent: '#294e73', highlight: 'rgba(147, 180, 208, 0.36)', highlightText: '#203a53', pattern: 'blank', font: editorial, headingFont: geometric, frame: 'thin', mood: 'editorial', layout: 'wide' },
      { id: 'product-strategy', name: 'Product Strategy', description: 'Modern indigo dot-grid paper for roadmaps and product bets.', tags: ['product', 'strategy'], paper: '#f7f7fc', line: 'rgba(75, 78, 157, 0.2)', text: '#30324c', muted: '#71738b', accent: '#4b4f9d', highlight: 'rgba(167, 167, 224, 0.4)', highlightText: '#292b58', pattern: 'dot-grid', font: modern, frame: 'rounded', mood: 'clean', layout: 'wide' },
      { id: 'design-critique', name: 'Design Critique', description: 'Generous white space and vivid coral for thoughtful design feedback.', tags: ['design', 'critique'], paper: '#fdfcfb', line: 'rgba(54, 66, 75, 0.13)', text: '#293238', muted: '#707a80', accent: '#e05d50', highlight: 'rgba(250, 180, 131, 0.42)', highlightText: '#4b2a1c', pattern: 'blank', font: modern, headingFont: geometric, frame: 'none', mood: 'clean', layout: 'airy' },
      { id: 'client-workshop', name: 'Client Workshop', description: 'Approachable teal graph paper for collaborative workshop capture.', tags: ['client', 'workshop'], paper: '#f1f8f6', line: 'rgba(38, 127, 117, 0.18)', major: 'rgba(38, 127, 117, 0.31)', text: '#28423f', muted: '#6b807c', accent: '#277f75', highlight: 'rgba(122, 202, 183, 0.38)', highlightText: '#1b443d', pattern: 'graph', font: humanist, frame: 'technical', mood: 'technical', layout: 'wide' },
      { id: 'sales-pipeline', name: 'Sales Pipeline', description: 'A confident green ledger for accounts, stages, and next actions.', tags: ['sales', 'pipeline'], paper: '#f5f8f3', line: 'rgba(55, 115, 73, 0.18)', major: 'rgba(55, 115, 73, 0.31)', text: '#2e4033', muted: '#6d7c70', accent: '#39784b', highlight: 'rgba(150, 201, 143, 0.42)', highlightText: '#254224', pattern: 'ledger', font: editorial, headingFont: geometric, frame: 'thin', mood: 'editorial' },
      { id: 'project-retrospective', name: 'Project Retrospective', description: 'Warm structured paper for wins, lessons, and next experiments.', tags: ['project', 'retrospective'], paper: '#fcf6eb', line: 'rgba(171, 104, 63, 0.18)', text: '#493b32', muted: '#7e7167', accent: '#b2633d', highlight: 'rgba(236, 177, 98, 0.42)', highlightText: '#4a2d17', pattern: 'cross-hatch', font: modern, frame: 'rounded', mood: 'clean' },
      { id: 'conference-notes', name: 'Conference Notes', description: 'Portable ruled notes for sessions, speakers, and follow-ups.', tags: ['conference', 'notes'], paper: '#fbfaf5', line: 'rgba(74, 116, 151, 0.22)', text: '#32404a', muted: '#707e86', accent: '#39739c', highlight: 'rgba(244, 195, 83, 0.44)', highlightText: '#40330f', pattern: 'ruled', font: humanist, frame: 'photo', mood: 'clean', margin: 'rgba(211, 90, 82, 0.44)' },
      { id: 'finance-ledger', name: 'Finance Ledger', description: 'Numerically precise green-gray ledger paper for financial analysis.', tags: ['finance', 'ledger'], paper: '#f4f7f3', line: 'rgba(54, 101, 74, 0.18)', major: 'rgba(54, 101, 74, 0.33)', text: '#2b3930', muted: '#68766c', accent: '#34664a', highlight: 'rgba(161, 194, 151, 0.38)', highlightText: '#294126', pattern: 'ledger', font: technical, frame: 'technical', mood: 'technical', layout: 'wide' },
    ],
  },
  {
    folder: 'Journaling & Wellness',
    tags: ['journaling', 'wellness'],
    templates: [
      { id: 'morning-pages', name: 'Morning Pages', description: 'Warm, easygoing ruled paper for uncensored morning writing.', tags: ['morning', 'freewriting'], paper: '#fff9eb', line: 'rgba(122, 148, 167, 0.2)', text: '#453d33', muted: '#7c7368', accent: '#c47745', highlight: 'rgba(238, 187, 103, 0.4)', highlightText: '#493018', pattern: 'ruled', font: literarySerif, frame: 'photo', mood: 'literary' },
      { id: 'gratitude-garden', name: 'Gratitude Garden', description: 'Soft botanical greens for noticing and recording small joys.', tags: ['gratitude', 'botanical'], paper: '#f1f5e7', line: 'rgba(85, 129, 79, 0.18)', text: '#344234', muted: '#6e7b6c', accent: '#5f865a', highlight: 'rgba(175, 205, 139, 0.42)', highlightText: '#304322', pattern: 'scallop', font: serif, frame: 'scrapbook', mood: 'playful' },
      { id: 'mood-tracker', name: 'Mood Tracker', description: 'A gentle rainbow dot grid for patterns, feelings, and check-ins.', tags: ['mood', 'tracker'], paper: '#fff8fa', line: 'rgba(120, 134, 196, 0.2)', text: '#403b4a', muted: '#777181', accent: '#9c67ad', highlight: 'rgba(242, 175, 190, 0.44)', highlightText: '#4b2f3a', pattern: 'dot-grid', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'dream-journal', name: 'Dream Journal', description: 'Moonlit lavender paper for fragments, symbols, and dream recall.', tags: ['dreams', 'sleep'], paper: '#272438', line: 'rgba(190, 178, 232, 0.15)', text: '#eee9f5', muted: '#aaa2ba', accent: '#bba9e3', highlight: 'rgba(110, 90, 161, 0.55)', highlightText: '#f7f3ff', pattern: 'diagonal', font: literarySerif, frame: 'dark', mood: 'dramatic', watermark: '☾' },
      { id: 'meditation-log', name: 'Meditation Log', description: 'Quiet rice-white space for sits, observations, and intentions.', tags: ['meditation', 'mindfulness'], paper: '#f5f2e9', line: 'rgba(105, 111, 102, 0.14)', text: '#343632', muted: '#777972', accent: '#6e786a', highlight: 'rgba(185, 188, 166, 0.36)', highlightText: '#34382f', pattern: 'blank', font: serif, frame: 'none', mood: 'clean', layout: 'airy' },
      { id: 'therapy-reflection', name: 'Therapy Reflection', description: 'A grounded blue-gray page for private reflection and reframing.', tags: ['therapy', 'reflection'], paper: '#f0f5f5', line: 'rgba(82, 128, 139, 0.18)', text: '#33454a', muted: '#718287', accent: '#527f89', highlight: 'rgba(168, 205, 202, 0.4)', highlightText: '#2c4747', pattern: 'ruled', font: humanist, frame: 'rounded', mood: 'clean' },
      { id: 'habit-bloom', name: 'Habit Bloom', description: 'Cheerful petal-pattern paper for routines and gentle consistency.', tags: ['habits', 'tracker'], paper: '#fff6ed', line: 'rgba(213, 121, 117, 0.18)', text: '#4c3b39', muted: '#816f6d', accent: '#d16f78', highlight: 'rgba(247, 190, 119, 0.44)', highlightText: '#4c321a', pattern: 'scallop', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'self-care-sunday', name: 'Self-Care Sunday', description: 'Cozy peach and lilac notes for rest, reset, and restoration.', tags: ['self-care', 'rest'], paper: '#fbefeb', line: 'rgba(139, 112, 164, 0.17)', text: '#493c4c', muted: '#7d7080', accent: '#8c70a5', highlight: 'rgba(236, 169, 140, 0.45)', highlightText: '#492f26', pattern: 'cross-hatch', font: rounded, frame: 'polaroid', mood: 'playful' },
    ],
  },
  {
    folder: 'Travel',
    tags: ['travel', 'places'],
    templates: [
      { id: 'alpine-trek', name: 'Alpine Trek', description: 'Crisp mountain-air paper for routes, peaks, and trail memories.', tags: ['alpine', 'hiking'], paper: '#eef4ed', line: 'rgba(58, 105, 78, 0.2)', text: '#304037', muted: '#6b7a70', accent: '#477c5c', highlight: 'rgba(161, 192, 137, 0.4)', highlightText: '#2d4225', pattern: 'graph', font: humanist, frame: 'technical', mood: 'technical' },
      { id: 'coastal-postcard', name: 'Coastal Postcard', description: 'Sea-glass blue and coral for breezy coastal travel stories.', tags: ['coast', 'postcard'], paper: '#eff9f7', line: 'rgba(44, 131, 145, 0.19)', text: '#29464a', muted: '#688185', accent: '#dd745f', highlight: 'rgba(110, 197, 190, 0.4)', highlightText: '#20403f', pattern: 'ruled', font: humanist, frame: 'polaroid', mood: 'playful' },
      { id: 'tokyo-night', name: 'Tokyo Night', description: 'Electric signs and midnight indigo for after-dark city notes.', tags: ['tokyo', 'night'], paper: '#17182b', line: 'rgba(83, 215, 224, 0.14)', major: 'rgba(242, 72, 171, 0.25)', text: '#edf1fa', muted: '#9ca5bd', accent: '#55d8df', highlight: 'rgba(240, 65, 167, 0.54)', highlightText: '#fff5fc', pattern: 'graph', font: mono, frame: 'dark', mood: 'dramatic' },
      { id: 'paris-cafe', name: 'Paris Café', description: 'Cream café stationery with burgundy ink and literary charm.', tags: ['paris', 'cafe'], paper: '#f2e5cf', line: 'rgba(102, 69, 49, 0.17)', text: '#4a3428', muted: '#7d6958', accent: '#843d48', highlight: 'rgba(196, 148, 82, 0.38)', highlightText: '#3e2917', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary' },
      { id: 'mediterranean-diary', name: 'Mediterranean Diary', description: 'Whitewashed paper, cobalt ink, and lemon-yellow sunlight.', tags: ['mediterranean', 'diary'], paper: '#fffdf0', line: 'rgba(39, 91, 173, 0.2)', text: '#2e3d5a', muted: '#6f7890', accent: '#2d5eb1', highlight: 'rgba(239, 207, 65, 0.48)', highlightText: '#40370d', pattern: 'scallop', font: serif, frame: 'photo', mood: 'playful' },
      { id: 'desert-roadtrip', name: 'Desert Roadtrip', description: 'Canyon orange and turquoise on sun-faded map paper.', tags: ['desert', 'roadtrip'], paper: '#f3e3c7', line: 'rgba(135, 83, 49, 0.2)', text: '#4b3829', muted: '#806a56', accent: '#267c7a', highlight: 'rgba(219, 143, 66, 0.42)', highlightText: '#462c13', pattern: 'dot-grid', font: geometric, frame: 'scrapbook', mood: 'playful' },
      { id: 'tropical-escape', name: 'Tropical Escape', description: 'Palm green and hibiscus pink for vivid island adventures.', tags: ['tropical', 'island'], paper: '#eef8e8', line: 'rgba(48, 126, 76, 0.19)', text: '#2f4935', muted: '#6e826f', accent: '#dd5579', highlight: 'rgba(151, 210, 118, 0.43)', highlightText: '#2c451f', pattern: 'hex', font: rounded, frame: 'polaroid', mood: 'playful' },
      { id: 'city-explorer', name: 'City Explorer', description: 'A compact transit-map grid for neighborhoods, stops, and discoveries.', tags: ['city', 'urban'], paper: '#f5f5f2', line: 'rgba(55, 69, 79, 0.17)', major: 'rgba(202, 70, 62, 0.3)', text: '#293238', muted: '#6d777c', accent: '#c94b45', highlight: 'rgba(244, 180, 62, 0.44)', highlightText: '#42300d', pattern: 'graph', font: editorial, headingFont: geometric, frame: 'technical', mood: 'technical', layout: 'compact' },
    ],
  },
  {
    folder: 'Nature',
    tags: ['nature', 'outdoors'],
    templates: [
      { id: 'woodland-herbarium', name: 'Woodland Herbarium', description: 'Pressed-leaf greens and archival cream for botanical records.', tags: ['woodland', 'herbarium'], paper: '#eee8cf', line: 'rgba(73, 105, 66, 0.18)', text: '#3b4634', muted: '#727b69', accent: '#52734a', highlight: 'rgba(153, 181, 117, 0.4)', highlightText: '#304025', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary' },
      { id: 'coastal-fog', name: 'Coastal Fog', description: 'Mist gray, muted blue, and spacious typography for quiet observations.', tags: ['coast', 'fog'], paper: '#edf1f0', line: 'rgba(90, 119, 127, 0.17)', text: '#344247', muted: '#748186', accent: '#5b7d86', highlight: 'rgba(175, 199, 199, 0.4)', highlightText: '#304747', pattern: 'blank', font: editorial, headingFont: serif, frame: 'rounded', mood: 'clean', layout: 'airy' },
      { id: 'alpine-wildflower', name: 'Alpine Wildflower', description: 'Cool stone paper scattered with violet wildflower accents.', tags: ['alpine', 'wildflower'], paper: '#f0f2e9', line: 'rgba(91, 113, 96, 0.18)', text: '#38433a', muted: '#737d74', accent: '#7b659d', highlight: 'rgba(188, 181, 218, 0.42)', highlightText: '#3e3255', pattern: 'dot-grid', font: humanist, frame: 'photo', mood: 'playful' },
      { id: 'desert-bloom', name: 'Desert Bloom', description: 'Sand, cactus green, and coral flowers in a sunlit dot grid.', tags: ['desert', 'bloom'], paper: '#f4e6cf', line: 'rgba(112, 100, 67, 0.19)', text: '#473c2d', muted: '#7b705e', accent: '#c45f51', highlight: 'rgba(145, 177, 109, 0.42)', highlightText: '#304023', pattern: 'dot-grid', font: rounded, frame: 'scrapbook', mood: 'playful' },
      { id: 'moss-and-stone', name: 'Moss & Stone', description: 'Deep moss, mineral gray, and quiet cross-hatching for field notes.', tags: ['moss', 'stone'], paper: '#dde3d7', line: 'rgba(69, 85, 69, 0.19)', text: '#354036', muted: '#6b756c', accent: '#536f50', highlight: 'rgba(137, 161, 121, 0.42)', highlightText: '#2c3d27', pattern: 'cross-hatch', font: serif, frame: 'technical', mood: 'literary' },
      { id: 'river-sketches', name: 'River Sketches', description: 'Flowing blue lines and open cream space for waterside sketches.', tags: ['river', 'sketches'], paper: '#f7f5e9', line: 'rgba(64, 126, 148, 0.18)', text: '#34464b', muted: '#708086', accent: '#43809a', highlight: 'rgba(151, 199, 208, 0.4)', highlightText: '#28444b', pattern: 'diagonal', font: humanist, frame: 'scrapbook', mood: 'playful', layout: 'wide' },
      { id: 'night-garden', name: 'Night Garden', description: 'Moonlit leaves and pale blossoms on deep garden green.', tags: ['night', 'garden'], paper: '#152622', line: 'rgba(139, 197, 169, 0.14)', text: '#e6f0e9', muted: '#9db0a4', accent: '#a7d6bb', highlight: 'rgba(104, 126, 84, 0.55)', highlightText: '#f4fbf6', pattern: 'scallop', font: literarySerif, frame: 'dark', mood: 'dramatic', watermark: '☾' },
      { id: 'sunflower-field', name: 'Sunflower Field', description: 'Sunny gold and leaf green for bright outdoor memories.', tags: ['sunflower', 'field'], paper: '#fff7d9', line: 'rgba(81, 123, 72, 0.18)', text: '#394331', muted: '#727d68', accent: '#598047', highlight: 'rgba(238, 183, 45, 0.48)', highlightText: '#443209', pattern: 'ruled', font: rounded, frame: 'polaroid', mood: 'playful', margin: 'rgba(198, 112, 48, 0.42)' },
    ],
  },
  {
    folder: 'Vintage & Editorial',
    tags: ['vintage', 'editorial'],
    templates: [
      { id: 'twenties-gazette', name: '1920s Gazette', description: 'Newsprint ivory, condensed headlines, and bold black rules.', tags: ['1920s', 'newspaper'], paper: '#e8dfc8', line: 'rgba(45, 42, 36, 0.16)', text: '#292722', muted: '#68645b', accent: '#171715', highlight: 'rgba(178, 159, 111, 0.4)', highlightText: '#292315', pattern: 'ledger', font: serif, headingFont: 'Impact, "Arial Narrow", sans-serif', frame: 'vintage', mood: 'editorial', layout: 'wide' },
      { id: 'midcentury-magazine', name: 'Midcentury Magazine', description: 'Optimistic coral, aqua, and geometric midcentury typography.', tags: ['midcentury', 'magazine'], paper: '#f3ead8', line: 'rgba(49, 121, 126, 0.17)', text: '#3e3b31', muted: '#777265', accent: '#d45f45', highlight: 'rgba(89, 177, 174, 0.4)', highlightText: '#243f3e', pattern: 'diagonal', font: geometric, frame: 'photo', mood: 'editorial' },
      { id: 'victorian-correspondence', name: 'Victorian Correspondence', description: 'Formal cream stationery with oxblood ink and ornate restraint.', tags: ['victorian', 'letter'], paper: '#eee2c5', line: 'rgba(106, 73, 45, 0.17)', text: '#473424', muted: '#796550', accent: '#753f3a', highlight: 'rgba(185, 141, 72, 0.35)', highlightText: '#3b2916', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary', margin: 'rgba(117, 63, 58, 0.4)' },
      { id: 'pulp-paperback', name: 'Pulp Paperback', description: 'Punchy scarlet and yellow inspired by dramatic paperback covers.', tags: ['pulp', 'paperback'], paper: '#eee0b6', line: 'rgba(77, 47, 31, 0.17)', text: '#3b2d22', muted: '#716050', accent: '#b83e2e', highlight: 'rgba(230, 178, 45, 0.52)', highlightText: '#392b0b', pattern: 'cross-hatch', font: serif, headingFont: 'Impact, "Arial Black", sans-serif', frame: 'vintage', mood: 'dramatic' },
      { id: 'bauhaus-review', name: 'Bauhaus Review', description: 'Primary shapes, sharp grids, and functional geometric type.', tags: ['bauhaus', 'modernism'], paper: '#f3f0e5', line: 'rgba(33, 39, 45, 0.17)', major: 'rgba(29, 85, 147, 0.32)', text: '#24292d', muted: '#666d72', accent: '#cf342d', highlight: 'rgba(226, 185, 36, 0.48)', highlightText: '#352e09', pattern: 'graph', font: geometric, frame: 'technical', mood: 'technical', layout: 'wide' },
      { id: 'film-noir-dossier', name: 'Film Noir Dossier', description: 'Shadowy charcoal dossier paper with hard-boiled cream type.', tags: ['film-noir', 'dossier'], paper: '#1e1e1c', line: 'rgba(224, 217, 194, 0.12)', text: '#e5dfcc', muted: '#a29d90', accent: '#d2c39b', highlight: 'rgba(123, 28, 28, 0.62)', highlightText: '#fff0e7', pattern: 'ledger', font: mono, headingFont: 'Impact, "Arial Narrow", sans-serif', frame: 'dark', mood: 'dramatic' },
      { id: 'library-card', name: 'Library Card', description: 'Catalog-card buff with typewriter text and stamped blue details.', tags: ['library', 'catalog'], paper: '#e9dfc4', line: 'rgba(68, 89, 104, 0.19)', text: '#3c352a', muted: '#746c5e', accent: '#41657b', highlight: 'rgba(183, 157, 93, 0.4)', highlightText: '#3c3016', pattern: 'ledger', font: mono, frame: 'photo', mood: 'technical', layout: 'compact' },
      { id: 'sunday-supplement', name: 'Sunday Supplement', description: 'Warm newsprint, elegant serif copy, and magazine-red accents.', tags: ['newspaper', 'supplement'], paper: '#f0e8d5', line: 'rgba(59, 55, 47, 0.14)', text: '#302d27', muted: '#6d685e', accent: '#a23f36', highlight: 'rgba(206, 174, 107, 0.4)', highlightText: '#3c301b', pattern: 'blank', font: serif, headingFont: editorial, frame: 'thin', mood: 'editorial', layout: 'wide' },
    ],
  },
  {
    folder: 'Dark & Neon',
    tags: ['dark', 'neon'],
    templates: [
      { id: 'neon-arcade', name: 'Neon Arcade', description: 'Hot pink and cyan lights on a black arcade grid.', tags: ['arcade', 'cyber'], paper: '#101017', line: 'rgba(0, 224, 239, 0.15)', major: 'rgba(255, 51, 166, 0.27)', text: '#edf8f8', muted: '#91a5aa', accent: '#00e0ef', highlight: 'rgba(255, 51, 166, 0.56)', highlightText: '#fff7fc', pattern: 'graph', font: mono, frame: 'dark', mood: 'dramatic' },
      { id: 'synthwave-sunset', name: 'Synthwave Sunset', description: 'Purple night, laser grids, and a blazing synthwave sunset.', tags: ['synthwave', 'sunset'], paper: '#1b1534', line: 'rgba(74, 226, 245, 0.14)', major: 'rgba(229, 69, 180, 0.28)', text: '#f0eafa', muted: '#aaa0c1', accent: '#f04bb3', highlight: 'rgba(247, 139, 54, 0.58)', highlightText: '#30190a', pattern: 'graph', font: geometric, frame: 'dark', mood: 'dramatic', watermark: '◢' },
      { id: 'hacker-console', name: 'Hacker Console', description: 'Phosphor green terminal paper for code notes and system logs.', tags: ['terminal', 'code'], paper: '#0e150f', line: 'rgba(91, 245, 112, 0.16)', text: '#a0f2a9', muted: '#62996a', accent: '#61ee72', highlight: 'rgba(97, 238, 114, 0.34)', highlightText: '#0b1d0d', pattern: 'dot-grid', font: mono, frame: 'dark', mood: 'technical' },
      { id: 'ultraviolet-club', name: 'Ultraviolet Club', description: 'Deep violet and ultraviolet glow for bold creative notes.', tags: ['ultraviolet', 'club'], paper: '#181225', line: 'rgba(190, 96, 255, 0.16)', text: '#f1eafb', muted: '#ad9dbd', accent: '#c064ff', highlight: 'rgba(51, 224, 226, 0.5)', highlightText: '#092e30', pattern: 'hex', font: modern, headingFont: geometric, frame: 'dark', mood: 'dramatic' },
      { id: 'acid-lime', name: 'Acid Lime', description: 'Near-black paper with sharp acid-lime signals and angular structure.', tags: ['acid', 'lime'], paper: '#131511', line: 'rgba(190, 255, 64, 0.15)', text: '#eaf4df', muted: '#95a08d', accent: '#bfff42', highlight: 'rgba(99, 72, 218, 0.58)', highlightText: '#faf8ff', pattern: 'diagonal', font: mono, frame: 'dark', mood: 'dramatic' },
      { id: 'crimson-circuit', name: 'Crimson Circuit', description: 'Crimson signals and steel-gray circuitry on black technical paper.', tags: ['crimson', 'circuit'], paper: '#151618', line: 'rgba(207, 68, 76, 0.17)', major: 'rgba(198, 207, 216, 0.23)', text: '#edf0f2', muted: '#999fa4', accent: '#e04b55', highlight: 'rgba(105, 122, 142, 0.54)', highlightText: '#f4f7f9', pattern: 'cross-hatch', font: technical, frame: 'technical', mood: 'technical' },
      { id: 'midnight-oled', name: 'Midnight OLED', description: 'True-black minimalism with calm ice-blue highlights.', tags: ['oled', 'minimal'], paper: '#090a0c', line: 'rgba(126, 167, 196, 0.13)', text: '#e9edf0', muted: '#8d969d', accent: '#7eb4d5', highlight: 'rgba(62, 104, 137, 0.54)', highlightText: '#f2f8fb', pattern: 'blank', font: modern, frame: 'none', mood: 'clean', layout: 'airy' },
      { id: 'electric-aquarium', name: 'Electric Aquarium', description: 'Bioluminescent aqua and coral drifting through a deep ocean page.', tags: ['aquarium', 'bioluminescent'], paper: '#071d28', line: 'rgba(76, 218, 207, 0.15)', text: '#dcf4f2', muted: '#88aaa9', accent: '#4cdacf', highlight: 'rgba(255, 103, 125, 0.52)', highlightText: '#fff7f8', pattern: 'scallop', font: rounded, frame: 'dark', mood: 'playful' },
    ],
  },
  {
    folder: 'Fantasy & Whimsy',
    tags: ['fantasy', 'whimsical'],
    templates: [
      { id: 'enchanted-forest', name: 'Enchanted Forest', description: 'Emerald shadows and antique gold for woodland tales and quests.', tags: ['forest', 'enchanted'], paper: '#1c3027', line: 'rgba(185, 201, 134, 0.14)', text: '#e8eedf', muted: '#a2ae96', accent: '#c0b66f', highlight: 'rgba(91, 139, 93, 0.58)', highlightText: '#f2f8ed', pattern: 'cross-hatch', font: literarySerif, frame: 'dark', mood: 'dramatic', watermark: '✦' },
      { id: 'dragon-scholar', name: 'Dragon Scholar', description: 'Charcoal parchment and ember-red annotations from a dragon archive.', tags: ['dragon', 'scholar'], paper: '#2a2420', line: 'rgba(205, 164, 112, 0.14)', text: '#eee2d0', muted: '#b0a28f', accent: '#d06a48', highlight: 'rgba(181, 124, 55, 0.55)', highlightText: '#25170c', pattern: 'hex', font: serif, headingFont: literarySerif, frame: 'dark', mood: 'dramatic' },
      { id: 'fairy-garden', name: 'Fairy Garden', description: 'Dewy mint and petal pink with playful garden scallops.', tags: ['fairy', 'garden'], paper: '#f1faec', line: 'rgba(109, 169, 113, 0.19)', text: '#3b493a', muted: '#748472', accent: '#d878a4', highlight: 'rgba(179, 220, 157, 0.44)', highlightText: '#304526', pattern: 'scallop', font: rounded, frame: 'scrapbook', mood: 'playful', watermark: '✧' },
      { id: 'celestial-oracle', name: 'Celestial Oracle', description: 'Midnight indigo, silver stars, and luminous oracle violet.', tags: ['celestial', 'oracle'], paper: '#181a35', line: 'rgba(179, 189, 231, 0.15)', text: '#eceefa', muted: '#a2a7c1', accent: '#b6a5ed', highlight: 'rgba(79, 91, 163, 0.56)', highlightText: '#f8f7ff', pattern: 'dot-grid', font: literarySerif, frame: 'dark', mood: 'dramatic', watermark: '☾' },
      { id: 'alchemist-ledger', name: 'Alchemist Ledger', description: 'Weathered laboratory ledger for formulas, ingredients, and discoveries.', tags: ['alchemy', 'ledger'], paper: '#e6d7b5', line: 'rgba(87, 72, 44, 0.18)', major: 'rgba(84, 111, 79, 0.3)', text: '#453a29', muted: '#776b56', accent: '#527056', highlight: 'rgba(183, 141, 67, 0.38)', highlightText: '#3c2d16', pattern: 'ledger', font: technical, headingFont: literarySerif, frame: 'vintage', mood: 'technical' },
      { id: 'mermaid-cove', name: 'Mermaid Cove', description: 'Seafoam, pearl, and coral curves for stories beneath the waves.', tags: ['mermaid', 'ocean'], paper: '#eaf8f5', line: 'rgba(63, 153, 159, 0.18)', text: '#2f4b4c', muted: '#6c8585', accent: '#c76483', highlight: 'rgba(121, 210, 197, 0.44)', highlightText: '#23433f', pattern: 'scallop', font: rounded, headingFont: serif, frame: 'rounded', mood: 'playful' },
      { id: 'hearthling-nook', name: 'Hearthling Nook', description: 'Cozy moss, honey, and fireplace warmth for homely adventures.', tags: ['cozy', 'hearth'], paper: '#efe2c4', line: 'rgba(93, 105, 67, 0.18)', text: '#443a28', muted: '#756b56', accent: '#9b5c35', highlight: 'rgba(205, 166, 75, 0.42)', highlightText: '#3d2e12', pattern: 'ruled', font: literarySerif, frame: 'vintage', mood: 'literary', margin: 'rgba(117, 126, 75, 0.4)' },
      { id: 'storybook-castle', name: 'Storybook Castle', description: 'Royal blue, rose, and parchment for timeless storybook chapters.', tags: ['storybook', 'castle'], paper: '#f1e8d5', line: 'rgba(62, 76, 132, 0.18)', text: '#383850', muted: '#737386', accent: '#6a4e92', highlight: 'rgba(207, 139, 155, 0.42)', highlightText: '#492e38', pattern: 'diagonal', font: serif, headingFont: literarySerif, frame: 'polaroid', mood: 'literary', watermark: '♜' },
    ],
  },
  {
    folder: 'Pastels',
    tags: ['pastel', 'soft'],
    templates: [
      { id: 'blush-milk', name: 'Blush Milk', description: 'Milky blush paper with soft cocoa type and rose details.', tags: ['blush', 'rose'], paper: '#fff5f4', line: 'rgba(187, 114, 121, 0.17)', text: '#4b3a3a', muted: '#817171', accent: '#b76e79', highlight: 'rgba(239, 182, 184, 0.44)', highlightText: '#4b3033', pattern: 'ruled', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'lilac-cloud', name: 'Lilac Cloud', description: 'Airy lilac and cloud white for gentle, spacious notes.', tags: ['lilac', 'cloud'], paper: '#faf7ff', line: 'rgba(139, 112, 183, 0.18)', text: '#453d50', muted: '#7d7488', accent: '#846bb0', highlight: 'rgba(205, 189, 232, 0.48)', highlightText: '#3c3150', pattern: 'blank', font: modern, frame: 'none', mood: 'clean', layout: 'airy' },
      { id: 'pistachio-cream', name: 'Pistachio Cream', description: 'Pale pistachio dots and cream highlights for fresh planning.', tags: ['pistachio', 'cream'], paper: '#f5f8e9', line: 'rgba(119, 151, 91, 0.19)', text: '#3d4937', muted: '#75816f', accent: '#78965f', highlight: 'rgba(207, 220, 157, 0.46)', highlightText: '#354121', pattern: 'dot-grid', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'peach-sorbet', name: 'Peach Sorbet', description: 'Juicy peach, vanilla, and coral for bright daily pages.', tags: ['peach', 'sorbet'], paper: '#fff3e7', line: 'rgba(212, 129, 97, 0.18)', text: '#4a3c36', muted: '#7d706a', accent: '#d87a61', highlight: 'rgba(249, 190, 125, 0.46)', highlightText: '#4a2f1c', pattern: 'scallop', font: rounded, frame: 'polaroid', mood: 'playful' },
      { id: 'baby-blue', name: 'Baby Blue', description: 'Clean baby-blue ruling with soft navy typography.', tags: ['blue', 'calm'], paper: '#f0f8fc', line: 'rgba(94, 156, 190, 0.2)', text: '#344957', muted: '#728591', accent: '#6296b2', highlight: 'rgba(180, 218, 235, 0.48)', highlightText: '#2c4856', pattern: 'ruled', font: humanist, frame: 'photo', mood: 'clean', margin: 'rgba(220, 142, 151, 0.36)' },
      { id: 'buttercup-paper', name: 'Buttercup Paper', description: 'Creamy yellow paper with warm honey and soft gray details.', tags: ['buttercup', 'yellow'], paper: '#fff9df', line: 'rgba(158, 139, 73, 0.18)', text: '#494432', muted: '#7d7867', accent: '#a88735', highlight: 'rgba(241, 210, 101, 0.48)', highlightText: '#42370e', pattern: 'cross-hatch', font: serif, frame: 'rounded', mood: 'literary' },
      { id: 'mint-macaron', name: 'Mint Macaron', description: 'Confectionery mint with cocoa type and a crisp dotted rhythm.', tags: ['mint', 'macaron'], paper: '#effaf5', line: 'rgba(78, 158, 129, 0.18)', text: '#374a42', muted: '#70847b', accent: '#5a9d84', highlight: 'rgba(181, 226, 207, 0.48)', highlightText: '#2c4a3e', pattern: 'dot-grid', font: rounded, frame: 'rounded', mood: 'playful' },
      { id: 'cotton-candy-sky', name: 'Cotton Candy Sky', description: 'Dreamy pink and blue diagonals inspired by a pastel sunset.', tags: ['cotton-candy', 'sky'], paper: '#fff5fb', line: 'rgba(109, 160, 207, 0.18)', text: '#443c4c', muted: '#7b7383', accent: '#9a79b6', highlight: 'rgba(244, 174, 203, 0.46)', highlightText: '#4b3040', pattern: 'diagonal', font: rounded, frame: 'polaroid', mood: 'playful', watermark: '☁' },
    ],
  },
] as const;

export const PACK_NAMES: readonly string[] = PACKS.map((pack) => pack.folder);

export const PACKED_BUILT_IN_TEMPLATES: readonly TemplarTemplate[] = PACKS.flatMap(
  (pack) => pack.templates.map((seed, index) => createPackedTemplate(pack, seed, index)),
);
